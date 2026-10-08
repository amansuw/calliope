import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { readMetadata } from 'taglib-wasm/simple';
import { db, schema } from '../db';
import { fetchLyrics } from '../integrations/lyrics';
import { scheduleNavidromeScan } from '../integrations/navidrome';
import { bus } from '../events';
import { libraryStatus, reindexFiles } from '../library/scanner';
import { moveFile, samePath } from '../pipeline/worker';
import { renderTemplate } from '../pipeline/template';
import { getSettings } from '../settings';
import { fetchImage, writeArtwork, writeTags, type TagWrite } from '../tagger';

export const EDITABLE = [
	'title',
	'artist',
	'album',
	'albumArtist',
	'year',
	'trackNumber',
	'trackTotal',
	'discNumber',
	'genre',
	'comment'
] as const;
export type EditableField = (typeof EDITABLE)[number];

export interface StudioFile {
	id: string;
	path: string;
	relPath: string;
	format: string | null;
	lossless: boolean | null;
	bitrate: number | null;
	durationMs: number | null;
	hasArtwork: boolean;
	hasLyrics: boolean;
	mbRecordingId: string | null;
	tags: Record<EditableField, string | number | null>;
}

const first = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Read tags fresh from disk (the index may lag behind external edits). */
export async function loadFiles(ids: string[]): Promise<StudioFile[]> {
	const rows = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids.slice(0, 2000)))
		.all();
	const out: StudioFile[] = [];
	for (const r of rows) {
		let tags: Record<string, unknown> | null = null;
		try {
			tags = (await readMetadata(r.path)).tags as unknown as Record<string, unknown>;
		} catch {
			/* unreadable: fall back to the index */
		}
		// Show what's really in the file. The index holds filename guesses for untagged files,
		// which would look like existing tags here; only use it when the file can't be read.
		const t = tags ?? {
			title: r.title,
			artist: r.artist ? [r.artist] : [],
			album: r.album,
			albumArtist: r.albumArtist,
			year: r.year,
			track: r.trackNumber,
			totalTracks: r.trackTotal,
			discNumber: r.discNumber,
			genre: r.genre
		};
		const artists = t.artist as string[] | undefined;
		out.push({
			id: r.id,
			path: r.path,
			relPath: r.relPath,
			format: r.format,
			lossless: r.lossless,
			bitrate: r.bitrate,
			durationMs: r.durationMs,
			hasArtwork: r.hasArtwork,
			hasLyrics: r.hasLyrics,
			mbRecordingId: r.mbRecordingId,
			tags: {
				title: (first(t.title) as string) ?? null,
				artist: artists?.length ? artists.join('; ') : null,
				album: (first(t.album) as string) ?? null,
				albumArtist: (first(t.albumArtist) as string) ?? null,
				year: (t.year as number) || null,
				trackNumber: (t.track as number) || null,
				trackTotal: (t.totalTracks as number) || null,
				discNumber: (t.discNumber as number) || null,
				genre:
					Array.isArray(t.genre) && t.genre.length
						? t.genre.join('; ')
						: ((t.genre as string) ?? null),
				comment: (first(t.comment) as string) ?? null
			}
		});
	}
	const order = new Map(ids.map((id, i) => [id, i]));
	return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export interface SaveChange {
	id: string;
	tags?: Partial<Record<EditableField, string | number | null>>;
	mb?: { recordingId?: string | null; releaseId?: string | null; artistId?: string | null };
	artworkUrl?: string | null;
	lyrics?: string | null;
}

const num = (v: unknown) => {
	if (v === null || v === '' || v === undefined) return v === undefined ? undefined : null;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const str = (v: unknown) =>
	v === undefined ? undefined : v === null || String(v).trim() === '' ? null : String(v).trim();

export async function saveChanges(changes: SaveChange[], opts: { organize?: boolean } = {}) {
	const rows = new Map(
		db
			.select({ id: schema.libraryFiles.id, path: schema.libraryFiles.path })
			.from(schema.libraryFiles)
			.where(
				inArray(
					schema.libraryFiles.id,
					changes.map((c) => c.id)
				)
			)
			.all()
			.map((r) => [r.id, r.path])
	);
	const images = new Map<string, { data: Uint8Array; mime: string } | null>();
	const written: string[] = [];
	const savedIds: string[] = [];
	const errors: { id: string; error: string }[] = [];

	for (const c of changes) {
		const file = rows.get(c.id);
		if (!file) continue;
		try {
			const t = c.tags ?? {};
			const w: TagWrite = {
				title: str(t.title),
				// "A; B" in the grid means two artist values
				artists:
					t.artist === undefined
						? undefined
						: (str(t.artist)
								?.split(/\s*;\s*/)
								.filter(Boolean) ?? null),
				album: str(t.album),
				albumArtist: str(t.albumArtist),
				year: num(t.year),
				trackNumber: num(t.trackNumber),
				trackTotal: num(t.trackTotal),
				discNumber: num(t.discNumber),
				genre:
					t.genre === undefined
						? undefined
						: (str(t.genre)
								?.split(/\s*;\s*/)
								.filter(Boolean) ?? null),
				comment: str(t.comment),
				lyrics: c.lyrics,
				mbRecordingId: c.mb?.recordingId,
				mbReleaseId: c.mb?.releaseId,
				mbArtistId: c.mb?.artistId
			};
			await writeTags(file, w);
			if (c.artworkUrl) {
				if (!images.has(c.artworkUrl)) images.set(c.artworkUrl, await fetchImage(c.artworkUrl));
				const img = images.get(c.artworkUrl);
				if (img) await writeArtwork(file, img.data, img.mime);
				else throw new Error('Could not download artwork');
			}
			db.insert(schema.fileOps)
				.values({ kind: 'retag', fromPath: file, toPath: file, detail: c })
				.run();
			written.push(file);
			savedIds.push(c.id);
		} catch (err) {
			errors.push({ id: c.id, error: (err as Error).message });
		}
	}
	await reindexFiles(written);
	if (written.length) scheduleNavidromeScan();
	// Tags drive the folder layout: re-file saved files so album/artist changes move them too.
	let moved = 0;
	if (opts.organize && savedIds.length) {
		moved = (await organize(savedIds, getSettings().pipeline.pathTemplate, false)).moved;
	}
	return { saved: written.length, moved, errors };
}

/** Artwork from an uploaded image, applied to several files. */
export async function applyArtworkData(ids: string[], data: Uint8Array, mime: string) {
	const rows = db
		.select({ path: schema.libraryFiles.path })
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	for (const r of rows) await writeArtwork(r.path, data, mime);
	await reindexFiles(rows.map((r) => r.path));
	return rows.length;
}

export async function fetchLyricsFor(ids: string[]) {
	const rows = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	let found = 0;
	const prefer = getSettings().lyrics.preferSynced;
	for (const r of rows) {
		if (!r.artist || !r.title) continue;
		const l = await fetchLyrics({
			artist: r.artist,
			title: r.title,
			album: r.album,
			durationSec: r.durationMs ? r.durationMs / 1000 : null
		});
		const text = prefer ? (l?.synced ?? l?.plain) : (l?.plain ?? l?.synced);
		if (!text) continue;
		await writeTags(r.path, { lyrics: text });
		found++;
	}
	await reindexFiles(rows.map((r) => r.path));
	return { found, total: rows.length };
}

/** Move files so their paths match the library template. `dryRun` returns the plan only. */
export async function organize(ids: string[], template: string, dryRun: boolean) {
	const root = getSettings().paths.libraryDir;
	const rows = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	const taken = new Set<string>();
	const plan = rows.map((r) => {
		const rel = renderTemplate(template, {
			title: r.title,
			artist: r.artist,
			albumartist: r.albumArtist ?? r.artist,
			album: r.album,
			year: r.year,
			track: r.trackNumber,
			disc: r.discNumber,
			genre: r.genre
		});
		let to = path.join(root, `${rel}.${r.format ?? path.extname(r.path).slice(1)}`);
		// Case-only differences are the same file on case-insensitive disks: leave those alone.
		const same = to === r.path || samePath(to, r.path);
		if (!same) {
			const ext = path.extname(to);
			const base = to.slice(0, -ext.length);
			for (let i = 2; (fs.existsSync(to) && !samePath(to, r.path)) || taken.has(to); i++)
				to = `${base} (${i})${ext}`;
		}
		taken.add(to);
		return { id: r.id, from: r.path, to, changed: !same };
	});
	if (dryRun) return { plan, moved: 0 };

	let moved = 0;
	for (const p of plan.filter((p) => p.changed)) {
		p.to = moveFile(p.from, p.to);
		db.insert(schema.fileOps).values({ kind: 'move', fromPath: p.from, toPath: p.to }).run();
		db.update(schema.libraryFiles)
			.set({ path: p.to, relPath: path.relative(root, p.to) })
			.where(inArray(schema.libraryFiles.id, [p.id]))
			.run();
		db.update(schema.tracks)
			.set({ filePath: p.to })
			.where(inArray(schema.tracks.filePath, [p.from]))
			.run();
		pruneEmptyDirs(path.dirname(p.from), root);
		moved++;
	}
	if (moved) scheduleNavidromeScan();
	return { plan, moved };
}

/** Permanently delete a library file from disk. Only ever called from an explicit user confirmation. */
export function deleteLibraryFile(id: string) {
	const file = db.select().from(schema.libraryFiles).where(eq(schema.libraryFiles.id, id)).get();
	if (!file) return false;
	const root = path.resolve(getSettings().paths.libraryDir);
	// Never delete anything outside the library folder
	if (!path.resolve(file.path).startsWith(root + path.sep))
		throw new Error('This file is outside the library folder');
	fs.rmSync(file.path, { force: true });
	db.insert(schema.fileOps)
		.values({
			kind: 'delete',
			fromPath: file.path,
			detail: { id: file.id, title: file.title, artist: file.artist, size: file.size }
		})
		.run();
	db.delete(schema.libraryFiles).where(eq(schema.libraryFiles.id, file.id)).run();
	pruneEmptyDirs(path.dirname(file.path), root);
	bus.emit('library', libraryStatus());
	scheduleNavidromeScan();
	return true;
}

function pruneEmptyDirs(dir: string, root: string) {
	let d = dir;
	while (d.startsWith(root) && d !== root) {
		try {
			if (fs.readdirSync(d).filter((f) => f !== '.DS_Store').length) return;
			fs.rmSync(d, { recursive: true });
		} catch {
			return;
		}
		d = path.dirname(d);
	}
}
