import fs from 'node:fs';
import path from 'node:path';
import { and, eq, ne, or } from 'drizzle-orm';
import { FORMAT_PRESETS, type FormatPresetId } from '$lib/formats';
import type { TrackStatus } from '$lib/status';
import { matchKey, splitArtistTitle } from '$lib/text';
import { db, schema } from '../db';
import type { Track } from '../db/schema';
import { fetchLyrics } from '../integrations/lyrics';
import { findInLibrary } from '../library/lookup';
import { getSettings } from '../settings';
import { findMatch } from '../sources/match';
import { spotifyTrack } from '../sources/spotify';
import { ytVideoInfo } from '../sources/youtube';
import { fetchImage, readMetadata, writeArtwork, writeTags } from '../tagger';
import { cleanupStaging, downloadAudio, type DownloadProgress } from './download';
import { renderTemplate } from './template';
import { patchTrack } from './tracks';

export interface WorkerContext {
	signal: AbortSignal;
	log: (line: string) => void;
	stage: (status: TrackStatus) => void;
	progress: (p: DownloadProgress) => void;
}

export class SkipError extends Error {}
export class PermanentError extends Error {}

function checkAbort(signal: AbortSignal) {
	if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Run one track through every stage. Throws SkipError / PermanentError / anything (retryable). */
export async function processTrack(initial: Track, ctx: WorkerContext): Promise<void> {
	let t = initial;
	const update = (patch: Partial<Track>) => {
		t = patchTrack(t.id, patch) ?? { ...t, ...patch };
	};
	const settings = getSettings();

	// 1. Resolve metadata ---------------------------------------------------------------
	ctx.stage('resolving');
	if (t.provider === 'spotify' && t.spotifyId && (!t.title || !t.artist || !t.album)) {
		ctx.log(`Resolving Spotify track ${t.spotifyId}`);
		const meta = await spotifyTrack(t.spotifyId);
		update({
			title: t.title ?? meta.title,
			artist: t.artist ?? meta.artist,
			artists: t.artists ?? meta.artists,
			album: t.album ?? meta.album ?? null,
			albumArtist: t.albumArtist ?? meta.albumArtist ?? null,
			trackNumber: t.trackNumber ?? meta.trackNumber ?? null,
			discNumber: t.discNumber ?? meta.discNumber ?? null,
			year: t.year ?? meta.year ?? null,
			durationMs: t.durationMs ?? meta.durationMs ?? null,
			artworkUrl: t.artworkUrl ?? meta.artworkUrl ?? null
		});
	}
	if (t.provider === 'youtube' && t.youtubeId) {
		ctx.log(`Fetching video info for ${t.youtubeId}`);
		const info = await ytVideoInfo(t.youtubeId, { signal: ctx.signal });
		const guess = splitArtistTitle(info.title, info.channel);
		update({
			// YouTube Music's structured fields beat parsing the video title
			title: info.track ?? t.title ?? guess.title,
			artist: info.artist ?? t.artist ?? guess.artist,
			artists: info.artists.length ? info.artists : (t.artists ?? [guess.artist]),
			album: t.album ?? info.album,
			year: t.year ?? info.releaseYear,
			durationMs: info.durationSec ? Math.round(info.durationSec * 1000) : t.durationMs,
			artworkUrl: t.artworkUrl?.includes('i.scdn.co')
				? t.artworkUrl
				: (info.thumbnail ?? t.artworkUrl),
			matchUrl: `https://www.youtube.com/watch?v=${info.id}`,
			matchTitle: info.title,
			matchScore: 1
		});
	}
	checkAbort(ctx.signal);
	if (!t.title || !t.artist) throw new PermanentError('Could not determine title/artist');

	// 2. Duplicate checks -----------------------------------------------------------------
	if (!t.force) {
		const idMatch = or(
			t.spotifyId ? eq(schema.tracks.spotifyId, t.spotifyId) : undefined,
			t.youtubeId ? eq(schema.tracks.youtubeId, t.youtubeId) : undefined
		);
		if (idMatch) {
			const prior = db
				.select({ id: schema.tracks.id })
				.from(schema.tracks)
				.where(and(idMatch, ne(schema.tracks.id, t.id), eq(schema.tracks.status, 'done')))
				.get();
			if (prior) throw new SkipError('Already downloaded');
		}
		if (settings.pipeline.skipExisting) {
			const hit = findInLibrary(t.artist, t.title);
			if (hit) throw new SkipError(`Already in library: ${hit.path}`);
		}
	}

	// 3. Match to a YouTube upload ----------------------------------------------------------
	if (t.provider === 'spotify') {
		ctx.stage('matching');
		ctx.log(`Searching YouTube for "${t.artist} - ${t.title}"`);
		const match = await findMatch(
			{
				title: t.title,
				artist: t.artist,
				artists: t.artists ?? undefined,
				durationMs: t.durationMs
			},
			{ signal: ctx.signal, log: ctx.log }
		);
		if (!match) throw new PermanentError('No YouTube results');
		if (match.score < settings.pipeline.rejectScore) {
			throw new PermanentError(
				`Best match "${match.candidate.title}" scored ${match.score.toFixed(2)} — below the reject threshold`
			);
		}
		update({
			youtubeId: match.candidate.id,
			matchUrl: `https://www.youtube.com/watch?v=${match.candidate.id}`,
			matchTitle: match.candidate.title,
			matchScore: match.score,
			album: t.album ?? match.info?.album ?? null,
			year: t.year ?? match.info?.releaseYear ?? null
		});
	}
	checkAbort(ctx.signal);

	// 4. Download ----------------------------------------------------------------------
	ctx.stage('downloading');
	const preset = (
		t.formatPreset in FORMAT_PRESETS ? t.formatPreset : settings.pipeline.formatPreset
	) as FormatPresetId;
	let file: string;
	try {
		file = await downloadAudio(t.matchUrl!, t.id, preset, {
			signal: ctx.signal,
			onProgress: ctx.progress,
			onPostprocess: () => ctx.stage('processing'),
			onLog: ctx.log
		});
	} catch (err) {
		cleanupStaging(t.id);
		throw err;
	}

	try {
		// 5. Tag -------------------------------------------------------------------------
		ctx.stage('tagging');
		const durationSec = t.durationMs ? t.durationMs / 1000 : null;
		let lyrics: Awaited<ReturnType<typeof fetchLyrics>> = null;
		if (settings.lyrics.enabled) {
			lyrics = await fetchLyrics({ artist: t.artist, title: t.title, album: t.album, durationSec });
			ctx.log(lyrics ? `Lyrics found (${lyrics.synced ? 'synced' : 'plain'})` : 'No lyrics found');
		}
		const lyricText = settings.lyrics.preferSynced
			? (lyrics?.synced ?? lyrics?.plain)
			: (lyrics?.plain ?? lyrics?.synced);

		await writeTags(file, {
			title: t.title,
			artists: t.artists?.length ? t.artists : [t.artist],
			album: t.album ?? undefined,
			albumArtist: t.albumArtist ?? t.artists?.[0] ?? t.artist,
			year: t.year ?? undefined,
			trackNumber: t.trackNumber ?? undefined,
			discNumber: t.discNumber ?? undefined,
			genre: t.genre ?? undefined,
			comment: t.matchUrl ?? undefined,
			lyrics: lyricText ?? undefined
		});

		let hasArtwork = false;
		if (t.artworkUrl) {
			const img = await fetchImage(t.artworkUrl);
			if (img) {
				await writeArtwork(file, img.data, img.mime);
				hasArtwork = true;
			} else ctx.log('Artwork download failed');
		}
		const meta = await readMetadata(file);
		checkAbort(ctx.signal);

		// 6. File into the library ------------------------------------------------------------
		ctx.stage('moving');
		const ext = path.extname(file).slice(1);
		const rel = renderTemplate(settings.pipeline.pathTemplate, {
			title: t.title,
			artist: t.artist,
			albumartist: t.albumArtist ?? t.artist,
			album: t.album,
			year: t.year,
			track: t.trackNumber,
			disc: t.discNumber,
			genre: t.genre
		});
		const dest = uniquePath(path.join(settings.paths.libraryDir, `${rel}.${ext}`));
		moveFile(file, dest);
		if (settings.lyrics.writeLrcFile && lyrics?.synced) {
			fs.writeFileSync(dest.replace(/\.[^.]+$/, '.lrc'), lyrics.synced);
		}
		const stat = fs.statSync(dest);
		ctx.log(`Saved to ${dest}`);

		update({
			filePath: dest,
			fileSize: stat.size,
			bitrate: meta.properties?.bitrate ?? null,
			hasArtwork,
			hasLyrics: !!lyricText,
			hasSyncedLyrics: !!lyrics?.synced
		});

		// Index immediately so the library and dedup checks see it without waiting for a scan.
		db.insert(schema.libraryFiles)
			.values({
				id: crypto.randomUUID(),
				path: dest,
				relPath: path.relative(settings.paths.libraryDir, dest),
				size: stat.size,
				mtimeMs: Math.floor(stat.mtimeMs),
				format: ext,
				codec: meta.properties?.codec ?? null,
				lossless: meta.properties?.isLossless ?? null,
				bitrate: meta.properties?.bitrate ?? null,
				sampleRate: meta.properties?.sampleRate ?? null,
				channels: meta.properties?.channels ?? null,
				durationMs: meta.properties ? Math.round(meta.properties.duration * 1000) : t.durationMs,
				title: t.title,
				artist: t.artist,
				album: t.album,
				albumArtist: t.albumArtist ?? t.artist,
				trackNumber: t.trackNumber,
				discNumber: t.discNumber,
				year: t.year,
				genre: t.genre,
				hasArtwork,
				hasLyrics: !!lyricText,
				matchKey: matchKey(t.artist, t.title),
				trackId: t.id
			})
			.onConflictDoNothing()
			.run();
	} finally {
		cleanupStaging(t.id);
	}
}

function uniquePath(p: string) {
	if (!fs.existsSync(p)) return p;
	const ext = path.extname(p);
	const base = p.slice(0, -ext.length);
	for (let i = 2; ; i++) {
		const candidate = `${base} (${i})${ext}`;
		if (!fs.existsSync(candidate)) return candidate;
	}
}

/** rename(), falling back to copy+unlink across filesystems (staging on SSD, library on HDD). */
export function moveFile(from: string, to: string) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	try {
		fs.renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		fs.copyFileSync(from, to);
		fs.rmSync(from);
	}
}
