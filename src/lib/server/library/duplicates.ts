/**
 * Duplicate detection over the library index.
 *
 * Three engines feed one union-find:
 *   exact     same audio-payload hash (identical audio, tags may differ)
 *   metadata  same normalized artist+title key, whatever the length
 *   acoustic  Chromaprint fingerprints that align (same recording, any codec/bitrate)
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { readCoverArt, readMetadata } from 'taglib-wasm/simple';
import { bin, checkBinaries } from '../binaries';
import { db, schema } from '../db';
import type { LibraryFile } from '../db/schema';
import { bus } from '../events';
import { scheduleNavidromeScan } from '../integrations/navidrome';
import { moveFile } from '../pipeline/worker';
import { runOk } from '../proc';
import { getSettings } from '../settings';
import { writeArtwork, writeTags } from '../tagger';
import { decodeRaw, encodeRaw, similarity, toPrint } from './fingerprint';
import { reindexFiles, setActivity } from './scanner';

export type DupReason = 'exact' | 'metadata' | 'acoustic';

export interface DupFile {
	id: string;
	path: string;
	relPath: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	albumArtist: string | null;
	year: number | null;
	trackNumber: number | null;
	genre: string | null;
	format: string | null;
	codec: string | null;
	lossless: boolean | null;
	bitrate: number | null;
	sampleRate: number | null;
	bitsPerSample: number | null;
	durationMs: number | null;
	size: number;
	hasArtwork: boolean;
	hasLyrics: boolean;
	mbRecordingId: string | null;
	addedAt: number;
	fromPipeline: boolean;
	quality: number;
	completeness: number;
}

export interface DupGroup {
	key: string;
	reasons: DupReason[];
	/** Best acoustic similarity inside the group, when fingerprints were compared */
	similarity: number | null;
	keeperId: string;
	files: DupFile[];
}

const CODEC_EFFICIENCY: Record<string, number> = { opus: 1.6, aac: 1.3, vorbis: 1.3, mp3: 1 };

/** Higher is better: lossless first, then effective bitrate. */
export function qualityScore(
	f: Pick<LibraryFile, 'lossless' | 'bitrate' | 'sampleRate' | 'bitsPerSample' | 'codec' | 'format'>
) {
	if (f.lossless) return 100_000 + (f.bitsPerSample ?? 16) * 1000 + (f.sampleRate ?? 44100) / 100;
	const eff = CODEC_EFFICIENCY[(f.codec ?? f.format ?? '').toLowerCase()] ?? 1;
	return (f.bitrate ?? 0) * eff;
}

export function completenessScore(
	f: Pick<
		LibraryFile,
		| 'title'
		| 'artist'
		| 'album'
		| 'albumArtist'
		| 'year'
		| 'trackNumber'
		| 'genre'
		| 'hasArtwork'
		| 'hasLyrics'
		| 'mbRecordingId'
	>
) {
	const fields = [f.title, f.artist, f.album, f.albumArtist, f.year, f.trackNumber, f.genre].filter(
		(v) => v !== null && v !== ''
	).length;
	return fields + (f.hasArtwork ? 2 : 0) + (f.hasLyrics ? 1 : 0) + (f.mbRecordingId ? 1 : 0);
}

function toDupFile(f: LibraryFile): DupFile {
	return {
		id: f.id,
		path: f.path,
		relPath: f.relPath,
		title: f.title,
		artist: f.artist,
		album: f.album,
		albumArtist: f.albumArtist,
		year: f.year,
		trackNumber: f.trackNumber,
		genre: f.genre,
		format: f.format,
		codec: f.codec,
		lossless: f.lossless,
		bitrate: f.bitrate,
		sampleRate: f.sampleRate,
		bitsPerSample: f.bitsPerSample,
		durationMs: f.durationMs,
		size: f.size,
		hasArtwork: f.hasArtwork,
		hasLyrics: f.hasLyrics,
		mbRecordingId: f.mbRecordingId,
		addedAt: f.addedAt.getTime(),
		fromPipeline: !!f.trackId,
		quality: qualityScore(f),
		completeness: completenessScore(f)
	};
}

/** Filenames that look like accidental copies: "Song (copy).mp3", "Song (2).mp3", "Song copy.mp3" */
const COPY_NAME = /(?:\(\s*(?:copy|\d+)\s*\)|\bcopy\b|\s-\s?copy)(?=\.[^.]+$|$)/i;

export function pickKeeper(files: DupFile[]) {
	const isCopy = (f: DupFile) => (COPY_NAME.test(f.relPath.split('/').pop() ?? '') ? 1 : 0);
	return [...files].sort(
		(a, b) =>
			b.quality - a.quality ||
			b.completeness - a.completeness ||
			isCopy(a) - isCopy(b) ||
			Number(b.fromPipeline) - Number(a.fromPipeline) ||
			a.addedAt - b.addedAt
	)[0];
}

class UnionFind {
	parent = new Map<string, string>();
	find(x: string): string {
		let p = this.parent.get(x) ?? x;
		if (p !== x) {
			p = this.find(p);
			this.parent.set(x, p);
		}
		return p;
	}
	union(a: string, b: string) {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent.set(ra, rb);
	}
}

export const groupKey = (ids: string[]) => [...ids].sort().join(',');

/**
 * Copies of one track rarely have the same length: a video upload adds an intro or outro, a rip
 * trailing silence. Files this far apart in length are compared by sound; beyond it only files
 * that already share an artist and title are.
 */
const DURATION_WINDOW_MS = 30_000;

export function findDuplicates(opts: { acousticThreshold?: number } = {}): DupGroup[] {
	const threshold = opts.acousticThreshold ?? 0.82;
	const files = db.select().from(schema.libraryFiles).all();
	const byId = new Map(files.map((f) => [f.id, f]));
	const uf = new UnionFind();
	const edgeReasons = new Map<string, Set<DupReason>>();
	const edgeSim = new Map<string, number>();
	const link = (a: string, b: string, reason: DupReason, sim?: number) => {
		uf.union(a, b);
		const k = a < b ? `${a}|${b}` : `${b}|${a}`;
		(edgeReasons.get(k) ?? edgeReasons.set(k, new Set()).get(k)!).add(reason);
		if (sim !== undefined) edgeSim.set(k, Math.max(sim, edgeSim.get(k) ?? 0));
	};

	// exact
	const byHash = new Map<string, string[]>();
	for (const f of files)
		if (f.audioHash && f.audioHash !== 'error')
			(byHash.get(f.audioHash) ?? byHash.set(f.audioHash, []).get(f.audioHash)!).push(f.id);
	for (const ids of byHash.values())
		for (let i = 1; i < ids.length; i++) link(ids[0], ids[i], 'exact');

	// metadata — the same artist and title is worth a look even when the lengths differ: a
	// truncated or padded download, or another cut the user can then dismiss
	const byKey = new Map<string, LibraryFile[]>();
	for (const f of files)
		if (f.matchKey) (byKey.get(f.matchKey) ?? byKey.set(f.matchKey, []).get(f.matchKey)!).push(f);
	for (const group of byKey.values())
		for (let i = 1; i < group.length; i++) link(group[0].id, group[i].id, 'metadata');

	// acoustic — compare fingerprints of tracks with similar durations only
	const printed = files
		.filter((f) => f.fingerprintRaw && f.durationMs)
		.map((f) => ({ id: f.id, dur: f.durationMs!, fp: toPrint(decodeRaw(f.fingerprintRaw!)) }))
		.sort((a, b) => a.dur - b.dur);
	const printOf = new Map(printed.map((p) => [p.id, p]));
	for (let i = 0; i < printed.length; i++) {
		for (
			let j = i + 1;
			j < printed.length && printed[j].dur - printed[i].dur <= DURATION_WINDOW_MS;
			j++
		) {
			const sim = similarity(printed[i].fp, printed[j].fp);
			if (sim >= threshold) link(printed[i].id, printed[j].id, 'acoustic', sim);
		}
	}
	// …and of same-named tracks further apart, to say whether they are one recording
	for (const group of byKey.values())
		for (let i = 0; i < group.length; i++)
			for (let j = i + 1; j < group.length; j++) {
				const a = printOf.get(group[i].id);
				const b = printOf.get(group[j].id);
				if (!a || !b || Math.abs(a.dur - b.dur) <= DURATION_WINDOW_MS) continue;
				const sim = similarity(a.fp, b.fp);
				if (sim >= threshold) link(a.id, b.id, 'acoustic', sim);
			}

	// assemble
	const members = new Map<string, string[]>();
	for (const f of files) {
		const root = uf.find(f.id);
		(members.get(root) ?? members.set(root, []).get(root)!).push(f.id);
	}
	const dismissed = new Set(
		db
			.select({ k: schema.duplicateDismissals.groupKey })
			.from(schema.duplicateDismissals)
			.all()
			.map((r) => r.k)
	);

	const groups: DupGroup[] = [];
	for (const ids of members.values()) {
		if (ids.length < 2) continue;
		const key = groupKey(ids);
		if (dismissed.has(key)) continue;
		const reasons = new Set<DupReason>();
		let sim: number | null = null;
		for (let i = 0; i < ids.length; i++)
			for (let j = i + 1; j < ids.length; j++) {
				const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
				for (const r of edgeReasons.get(k) ?? []) reasons.add(r);
				const s = edgeSim.get(k);
				if (s !== undefined) sim = Math.max(sim ?? 0, s);
			}
		const dfs = ids.map((id) => toDupFile(byId.get(id)!));
		groups.push({
			key,
			reasons: (['exact', 'acoustic', 'metadata'] as const).filter((r) => reasons.has(r)),
			similarity: sim,
			keeperId: pickKeeper(dfs).id,
			files: dfs
		});
	}
	// Strongest evidence first
	const weight = (g: DupGroup) =>
		g.reasons.includes('exact') ? 3 : g.reasons.includes('acoustic') ? 2 : 1;
	return groups.sort(
		(a, b) =>
			weight(b) - weight(a) || (b.files[0].artist ?? '').localeCompare(a.files[0].artist ?? '')
	);
}

export function dismissGroup(key: string) {
	db.insert(schema.duplicateDismissals).values({ groupKey: key }).onConflictDoNothing().run();
}

// ---------------- fingerprinting job ----------------

let fingerprinting = false;

export function fingerprintStats() {
	const total =
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.libraryFiles)
			.get()?.n ?? 0;
	const done =
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.libraryFiles)
			.where(sql`${schema.libraryFiles.fingerprintRaw} is not null`)
			.get()?.n ?? 0;
	return { total, done, running: fingerprinting };
}

export async function fingerprintLibrary() {
	if (fingerprinting) return;
	const fpcalc = (await checkBinaries()).find((b) => b.name === 'fpcalc');
	if (fpcalc?.error)
		throw new Error('Chromaprint (fpcalc) is not installed — see Settings › Binaries');
	fingerprinting = true;
	void (async () => {
		const pending = db
			.select({ id: schema.libraryFiles.id, path: schema.libraryFiles.path })
			.from(schema.libraryFiles)
			.where(isNull(schema.libraryFiles.fingerprintRaw))
			.all();
		let done = 0;
		try {
			setActivity('analyzing', 0, pending.length);
			for (const f of pending) {
				try {
					const res = await runOk(bin('fpcalc'), ['-raw', '-json', '-length', '120', f.path], {
						timeoutMs: 60_000
					});
					const data = JSON.parse(res.stdout) as { fingerprint: number[] };
					db.update(schema.libraryFiles)
						.set({ fingerprintRaw: encodeRaw(data.fingerprint) })
						.where(eq(schema.libraryFiles.id, f.id))
						.run();
				} catch {
					// Unfingerprintable (too short/corrupt): store an empty print so it isn't retried forever
					db.update(schema.libraryFiles)
						.set({ fingerprintRaw: '' })
						.where(eq(schema.libraryFiles.id, f.id))
						.run();
				}
				done++;
				setActivity('analyzing', done, pending.length, f.path);
			}
			bus.toast('success', 'Fingerprinting finished', `${done} files analyzed`, '/duplicates');
		} finally {
			fingerprinting = false;
			setActivity('idle');
		}
	})();
}

// ---------------- resolution ----------------

function quarantinePath(relPath: string) {
	const day = new Date().toISOString().slice(0, 10);
	let dest = path.join(getSettings().paths.quarantineDir, day, relPath);
	const ext = path.extname(dest);
	const base = dest.slice(0, -ext.length);
	for (let i = 2; fs.existsSync(dest); i++) dest = `${base} (${i})${ext}`;
	return dest;
}

export function quarantineFiles(ids: string[], redirectTo?: string) {
	const rows = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, ids))
		.all();
	for (const r of rows) {
		const dest = quarantinePath(r.relPath);
		moveFile(r.path, dest);
		db.insert(schema.fileOps)
			.values({
				kind: 'quarantine',
				fromPath: r.path,
				toPath: dest,
				detail: { id: r.id, title: r.title, artist: r.artist, size: r.size }
			})
			.run();
		db.delete(schema.libraryFiles).where(eq(schema.libraryFiles.id, r.id)).run();
		// Download history pointed at this file: point it at the keeper instead
		if (redirectTo)
			db.update(schema.tracks)
				.set({ filePath: redirectTo })
				.where(eq(schema.tracks.filePath, r.path))
				.run();
	}
	if (rows.length) scheduleNavidromeScan();
	return rows.length;
}

/** Copy tags/artwork/lyrics the keeper lacks from the other copies, then quarantine them. */
export async function resolveGroup(keepId: string, removeIds: string[], mergeTags: boolean) {
	const keeper = db
		.select()
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, keepId))
		.get();
	if (!keeper) throw new Error('Keeper file not found');
	const others = db
		.select()
		.from(schema.libraryFiles)
		.where(inArray(schema.libraryFiles.id, removeIds))
		.all();

	if (mergeTags && others.length) {
		const pick = <K extends keyof LibraryFile>(k: K) =>
			keeper[k] ? undefined : (others.find((o) => o[k])?.[k] ?? undefined);
		const patch = {
			album: pick('album') as string | undefined,
			albumArtist: pick('albumArtist') as string | undefined,
			year: pick('year') as number | undefined,
			trackNumber: pick('trackNumber') as number | undefined,
			trackTotal: pick('trackTotal') as number | undefined,
			discNumber: pick('discNumber') as number | undefined,
			genre: pick('genre') as string | undefined,
			isrc: pick('isrc') as string | undefined,
			mbRecordingId: pick('mbRecordingId') as string | undefined,
			mbReleaseId: pick('mbReleaseId') as string | undefined
		};
		let lyrics: string | undefined;
		if (!keeper.hasLyrics) {
			for (const o of others.filter((o) => o.hasLyrics)) {
				const tags = (await readMetadata(o.path).catch(() => null))?.tags as
					{ lyrics?: { text?: string }[] } | undefined;
				lyrics = tags?.lyrics?.find((l) => l.text)?.text;
				if (lyrics) break;
			}
		}
		if (Object.values(patch).some((v) => v !== undefined) || lyrics)
			await writeTags(keeper.path, { ...patch, lyrics });
		if (!keeper.hasArtwork) {
			for (const o of others.filter((o) => o.hasArtwork)) {
				const art = await readCoverArt(o.path).catch(() => undefined);
				if (art) {
					await writeArtwork(keeper.path, art, art[0] === 0x89 ? 'image/png' : 'image/jpeg');
					break;
				}
			}
		}
		await reindexFiles([keeper.path]);
	}

	const removed = quarantineFiles(removeIds, keeper.path);
	return { removed };
}

// ---------------- quarantine ----------------

export function listQuarantine() {
	const ops = db
		.select()
		.from(schema.fileOps)
		.where(eq(schema.fileOps.kind, 'quarantine'))
		.orderBy(sql`${schema.fileOps.createdAt} desc`)
		.all();
	return ops
		.filter((o) => o.toPath && fs.existsSync(o.toPath))
		.map((o) => {
			// detail also carries the library file's id — keep the op id authoritative
			const { title, artist, size } = (o.detail ?? {}) as {
				title?: string;
				artist?: string;
				size?: number;
			};
			return {
				id: o.id,
				from: o.fromPath!,
				to: o.toPath!,
				at: o.createdAt.getTime(),
				title,
				artist,
				size
			};
		});
}

export async function restoreQuarantined(opId: number) {
	const op = db
		.select()
		.from(schema.fileOps)
		.where(and(eq(schema.fileOps.id, opId), eq(schema.fileOps.kind, 'quarantine')))
		.get();
	if (!op?.toPath || !fs.existsSync(op.toPath)) throw new Error('Quarantined file not found');
	let dest = op.fromPath!;
	const ext = path.extname(dest);
	for (let i = 2; fs.existsSync(dest); i++)
		dest = `${op.fromPath!.slice(0, -ext.length)} (${i})${ext}`;
	moveFile(op.toPath, dest);
	db.insert(schema.fileOps).values({ kind: 'restore', fromPath: op.toPath, toPath: dest }).run();
	await reindexFiles([dest]);
	scheduleNavidromeScan();
	return dest;
}

/** Permanently delete quarantined files. Only ever called from an explicit user confirmation. */
export function purgeQuarantine(opIds: number[]) {
	const ops = db
		.select()
		.from(schema.fileOps)
		.where(and(inArray(schema.fileOps.id, opIds), eq(schema.fileOps.kind, 'quarantine')))
		.all();
	const root = path.resolve(getSettings().paths.quarantineDir);
	let deleted = 0;
	for (const op of ops) {
		// Never delete anything outside the quarantine folder
		if (!op.toPath || !path.resolve(op.toPath).startsWith(root + path.sep)) continue;
		if (fs.existsSync(op.toPath)) {
			fs.rmSync(op.toPath);
			deleted++;
		}
	}
	return deleted;
}
