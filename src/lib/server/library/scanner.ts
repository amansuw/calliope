/**
 * Library indexer.
 *
 * Walks the library folder, and only re-reads files whose size or mtime changed since the last
 * scan. Tag reads use taglib-wasm's seek-based WASI backend (headers only), so an incremental
 * pass over a large library is quick. Audio-payload hashing (for exact duplicate detection)
 * reads whole files and runs as a separate, lower-priority phase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { readMediaChecksum, readMetadataBatch } from 'taglib-wasm/simple';
import { matchKey, splitArtistTitle } from '$lib/text';
import type { LibraryStatus } from '$lib/types';
import { db, schema } from '../db';
import type { LibraryFile } from '../db/schema';
import { bus } from '../events';
import { getSettings } from '../settings';

export const AUDIO_EXTENSIONS = new Set([
	'.mp3',
	'.m4a',
	'.aac',
	'.flac',
	'.opus',
	'.ogg',
	'.oga',
	'.wav',
	'.aif',
	'.aiff',
	'.wma',
	'.wv',
	'.ape',
	'.alac'
]);

const BATCH = 64;

const status: LibraryStatus = {
	scanning: false,
	phase: 'idle',
	processed: 0,
	total: 0,
	current: null,
	lastScanAt: null,
	fileCount: 0
};

let lastEmit = 0;
function emit(force = false) {
	const now = Date.now();
	if (!force && now - lastEmit < 300) return;
	lastEmit = now;
	bus.emit('library', { ...status, fileCount: countFiles() });
}

const countFiles = () =>
	db
		.select({ n: sql<number>`count(*)` })
		.from(schema.libraryFiles)
		.get()?.n ?? 0;

/** Report background library work (fingerprinting etc.) through the same status channel as scans. */
export function setActivity(
	phase: LibraryStatus['phase'],
	processed = 0,
	total = 0,
	current: string | null = null
) {
	Object.assign(status, {
		scanning: phase !== 'idle' && phase !== 'done',
		phase: phase === 'done' ? 'idle' : phase,
		processed,
		total,
		current
	});
	emit(phase === 'idle' || phase === 'done' || processed === 0);
}

export function libraryStatus(): LibraryStatus {
	return { ...status, fileCount: countFiles() };
}

async function walk(root: string, out: { path: string; size: number; mtimeMs: number }[]) {
	let dir: fs.Dir;
	try {
		dir = await fs.promises.opendir(root);
	} catch (err) {
		console.warn(`[library] cannot read ${root}:`, (err as Error).message);
		return;
	}
	for await (const entry of dir) {
		if (entry.name.startsWith('.')) continue;
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			await walk(full, out);
		} else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			try {
				const st = await fs.promises.stat(full);
				out.push({ path: full, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
			} catch {
				/* vanished mid-walk */
			}
		}
		if (out.length % 500 === 0) {
			status.processed = out.length;
			emit();
		}
	}
}

const first = (v: string[] | string | undefined | null) => (Array.isArray(v) ? v[0] : v) || null;
const int = (v: unknown) =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

type Meta = Awaited<ReturnType<typeof readMetadataBatch>>['items'][number];

function rowFromMeta(
	file: { path: string; size: number; mtimeMs: number },
	root: string,
	item: Meta
) {
	const relPath = path.relative(root, file.path);
	const ext = path.extname(file.path).slice(1).toLowerCase();
	const base = {
		path: file.path,
		relPath,
		size: file.size,
		mtimeMs: file.mtimeMs,
		format: ext,
		scannedAt: new Date()
	};
	if (item.status !== 'ok') {
		// Unreadable: keep it indexed (so it shows up as a problem) with a filename guess.
		const guess = splitArtistTitle(path.basename(file.path, path.extname(file.path)));
		return {
			...base,
			title: guess.title,
			artist: guess.artist,
			matchKey: matchKey(guess.artist, guess.title)
		};
	}
	const { tags, properties, hasCoverArt } = item.data;
	const guess = splitArtistTitle(path.basename(file.path, path.extname(file.path)));
	const title = first(tags.title) ?? guess.title;
	const artist = tags.artist?.length ? tags.artist.join(', ') : guess.artist;
	const lyrics = (tags as { lyrics?: { text?: string }[] }).lyrics;
	return {
		...base,
		codec: properties?.codec ?? null,
		lossless: properties?.isLossless ?? null,
		bitrate: int(properties?.bitrate),
		sampleRate: int(properties?.sampleRate),
		bitsPerSample: int(properties?.bitsPerSample),
		channels: int(properties?.channels),
		durationMs: properties
			? Math.round((properties.durationMs ?? properties.duration * 1000) || 0) || null
			: null,
		title,
		artist,
		album: first(tags.album),
		albumArtist: first(tags.albumArtist),
		trackNumber: int(tags.track),
		trackTotal: int(tags.totalTracks),
		discNumber: int(tags.discNumber),
		year: int(tags.year),
		genre: first(tags.genre),
		isrc: first(tags.isrc),
		hasArtwork: hasCoverArt,
		hasLyrics: !!lyrics?.some((l) => l.text?.trim()),
		mbRecordingId: first(tags.musicbrainzTrackId),
		mbReleaseId: first(tags.musicbrainzReleaseId),
		acoustidId: first(tags.acoustidId),
		matchKey: matchKey(tags.artist?.[0] ?? artist, title)
	};
}

/** Re-read specific files (after the Studio or pipeline wrote to them). */
export async function reindexFiles(paths: string[]) {
	const root = getSettings().paths.libraryDir;
	const files = paths
		.filter((p) => fs.existsSync(p))
		.map((p) => {
			const st = fs.statSync(p);
			return { path: p, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
		});
	if (!files.length) return;
	const res = await readMetadataBatch(
		files.map((f) => f.path),
		{ concurrency: 4, continueOnError: true, includeProperties: ['LYRICS'] }
	);
	db.transaction((tx) => {
		res.items.forEach((item, i) => {
			const row = rowFromMeta(files[i], root, item);
			tx.insert(schema.libraryFiles)
				.values({ id: crypto.randomUUID(), ...row })
				.onConflictDoUpdate({
					target: schema.libraryFiles.path,
					set: {
						...row,
						audioHash: null,
						peaks: null,
						loudness: null,
						fingerprint: null,
						fingerprintRaw: null
					}
				})
				.run();
		});
	});
	void hashPending();
}

let running: Promise<void> | null = null;

export function scanLibrary(opts: { full?: boolean } = {}): Promise<void> {
	if (running) return running;
	running = doScan(opts).finally(() => {
		running = null;
	});
	return running;
}

async function doScan({ full = false }: { full?: boolean }) {
	const root = getSettings().paths.libraryDir;
	Object.assign(status, {
		scanning: true,
		phase: 'walking',
		processed: 0,
		total: 0,
		current: root
	});
	emit(true);
	const started = Date.now();
	try {
		if (!fs.existsSync(root)) throw new Error(`Library folder not found: ${root}`);

		const files: { path: string; size: number; mtimeMs: number }[] = [];
		await walk(root, files);

		const known = new Map(
			db
				.select({
					id: schema.libraryFiles.id,
					path: schema.libraryFiles.path,
					size: schema.libraryFiles.size,
					mtimeMs: schema.libraryFiles.mtimeMs
				})
				.from(schema.libraryFiles)
				.all()
				.map((r) => [r.path, r])
		);

		const onDisk = new Set(files.map((f) => f.path));
		const gone = [...known.values()].filter((k) => !onDisk.has(k.path)).map((k) => k.id);
		for (let i = 0; i < gone.length; i += 500) {
			db.delete(schema.libraryFiles)
				.where(inArray(schema.libraryFiles.id, gone.slice(i, i + 500)))
				.run();
		}

		const changed = files.filter((f) => {
			const k = known.get(f.path);
			return full || !k || k.size !== f.size || k.mtimeMs !== f.mtimeMs;
		});

		Object.assign(status, { phase: 'reading', processed: 0, total: changed.length });
		emit(true);

		// Link finished pipeline downloads to their files
		const trackByPath = new Map(
			db
				.select({ id: schema.tracks.id, filePath: schema.tracks.filePath })
				.from(schema.tracks)
				.where(sql`${schema.tracks.filePath} is not null`)
				.all()
				.map((t) => [t.filePath!, t.id])
		);

		for (let i = 0; i < changed.length; i += BATCH) {
			const slice = changed.slice(i, i + BATCH);
			status.current = slice[0]?.path ?? null;
			const res = await readMetadataBatch(
				slice.map((f) => f.path),
				{ concurrency: 8, continueOnError: true, includeProperties: ['LYRICS'] }
			);
			db.transaction((tx) => {
				res.items.forEach((item, j) => {
					const row = {
						...rowFromMeta(slice[j], root, item),
						trackId: trackByPath.get(slice[j].path) ?? null
					};
					tx.insert(schema.libraryFiles)
						.values({ id: crypto.randomUUID(), ...row })
						// Content may have changed: drop derived data so it gets recomputed.
						.onConflictDoUpdate({
							target: schema.libraryFiles.path,
							set: {
								...row,
								audioHash: null,
								peaks: null,
								loudness: null,
								fingerprint: null,
								fingerprintRaw: null
							}
						})
						.run();
				});
			});
			status.processed = Math.min(changed.length, i + BATCH);
			emit();
			// Yield so the event loop (HTTP, pipeline) stays responsive during big scans
			await new Promise((r) => setImmediate(r));
		}

		status.lastScanAt = Date.now();
		console.log(
			`[library] scanned ${files.length} files (${changed.length} read, ${gone.length} removed) in ${((Date.now() - started) / 1000).toFixed(1)}s`
		);
		if (changed.length || gone.length)
			bus.emit('toast', {
				id: crypto.randomUUID(),
				level: 'info',
				title: 'Library updated',
				message: `${changed.length} new or changed · ${gone.length} removed`,
				href: '/library'
			});
	} catch (err) {
		console.error('[library] scan failed:', err);
		bus.toast('error', 'Library scan failed', (err as Error).message, '/settings/library');
	} finally {
		Object.assign(status, { scanning: false, phase: 'idle', current: null });
		emit(true);
	}
	await hashPending();
}

let hashing = false;

/** Compute audio-payload hashes for files that don't have one yet. */
export async function hashPending() {
	if (hashing) return;
	hashing = true;
	try {
		for (;;) {
			const batch = db
				.select({ id: schema.libraryFiles.id, path: schema.libraryFiles.path })
				.from(schema.libraryFiles)
				.where(isNull(schema.libraryFiles.audioHash))
				.limit(32)
				.all();
			if (!batch.length) break;
			for (const f of batch) {
				let hash: string;
				try {
					hash = (await readMediaChecksum(f.path)).hex;
				} catch {
					hash = 'error';
				}
				db.update(schema.libraryFiles)
					.set({ audioHash: hash })
					.where(eq(schema.libraryFiles.id, f.id))
					.run();
			}
			await new Promise((r) => setImmediate(r));
		}
	} finally {
		hashing = false;
	}
}

let timer: NodeJS.Timeout | null = null;

export function startLibraryWatch() {
	const { scanOnStartup } = getSettings().library;
	if (scanOnStartup) setTimeout(() => void scanLibrary(), 3000).unref();
	scheduleRescan();
}

export function scheduleRescan() {
	if (timer) clearInterval(timer);
	const minutes = getSettings().library.rescanIntervalMinutes;
	if (!minutes) return;
	timer = setInterval(() => void scanLibrary(), minutes * 60_000);
	timer.unref();
}

export type { LibraryFile };
