import fs from 'node:fs';
import path from 'node:path';
import { and, eq, ne, or } from 'drizzle-orm';
import { FORMAT_PRESETS, type FormatPresetId } from '$lib/formats';
import { decodeRef, encodeRef, fileParts, type SlskRef } from '$lib/soulseek';
import type { TrackStatus } from '$lib/status';
import { matchKey, normalize, primaryArtist, similarity, splitArtistTitle } from '$lib/text';
import { db, schema } from '../db';
import {
	applyEnrichment,
	enrich,
	identifyRecording,
	sameAlbum,
	splitGenres,
	type Enrichment
} from '../enrich';
import type { Track } from '../db/schema';
import { fetchLyrics } from '../integrations/lyrics';
import { albumIdentity, findInLibrary } from '../library/lookup';
import { getSettings } from '../settings';
import { soulseek } from '../soulseek';
import { findMatch } from '../sources/match';
import {
	baseAlbum,
	describeReport,
	matchLossless,
	plainTitle,
	searchPlan,
	type MatchReport,
	type SlskPick,
	type SlskTarget
} from '../sources/soulseek-match';
import { acoustidReady, identifyFile } from '../studio/acoustid';
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

/** slsk-client holds a transfer in memory until it is complete, so very large files are refused. */
const MAX_SOULSEEK_BYTES = 400 * 1024 * 1024;
const first = (v: string[] | string | undefined | null) => (Array.isArray(v) ? v[0] : v) || null;
const int = (v: unknown) =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

/** Fetch a file a peer shares, keeping its original format. Returns the staged path. */
async function downloadSoulseek(id: string, ref: SlskRef, ctx: WorkerContext, waitMs?: number) {
	const status = soulseek.status();
	if (!status.enabled || !status.configured)
		throw new PermanentError('Soulseek is not set up — see Settings › Integrations');
	if (ref.size > MAX_SOULSEEK_BYTES)
		throw new PermanentError(
			`File is ${Math.round(ref.size / 1024 / 1024)} MB — over the 400 MB limit for Soulseek transfers`
		);
	const { name, ext } = fileParts(ref.file);
	const staging = getSettings().paths.stagingDir;
	fs.mkdirSync(staging, { recursive: true });
	const dest = path.join(staging, `${id}.${ext || 'bin'}`);
	ctx.log(`Requesting "${name}" from ${ref.user}`);
	await soulseek.download(
		ref,
		dest,
		{ signal: ctx.signal, onLog: ctx.log, onProgress: ctx.progress },
		waitMs
	);
	return dest;
}

/** Automatic lookups only use peers that can send now, and don't wait long for them. */
const AUTO_WAIT_MS = 90_000;
const AUTO_TRIES = 3;
/** Tracks of one album repeat the same album searches: answer those from memory for a while. */
const REUSE_SEARCH_MS = 10 * 60_000;
/** Folder that last delivered a track of an album, tried first for the album's other tracks. */
const albumSources = new Map<string, { user: string; dir: string }>();

/**
 * What to look for on Soulseek. Spotify metadata is clean; a YouTube video title is not
 * ("Song ft. Someone (Official Video)"), so MusicBrainz supplies the proper title, album and
 * track number first.
 */
async function soulseekTarget(t: Track): Promise<SlskTarget> {
	const base: SlskTarget = {
		title: plainTitle(t.title!),
		artist: t.artist!,
		artists: t.artists ?? undefined,
		durationMs: t.durationMs,
		album: t.album,
		trackNumber: t.trackNumber
	};
	if (t.provider === 'spotify' || !getSettings().pipeline.enrichMusicBrainz) return base;
	const mb = await identifyRecording({
		artist: t.artist!,
		title: base.title,
		durationMs: t.durationMs
	}).catch(() => null);
	if (!mb) return base;
	return {
		title: mb.title,
		artist: mb.artists[0] ?? mb.artist,
		artists: mb.artists.length ? mb.artists : undefined,
		// Shared files are album rips: the album recording's length is the one to compare with
		durationMs: mb.durationMs ?? t.durationMs,
		album: mb.album ?? t.album,
		trackNumber: mb.trackNumber ?? t.trackNumber
	};
}

/** The audio itself says which recording this is. Null when it agrees or cannot tell. */
async function fingerprintProblem(file: string, target: SlskTarget): Promise<string | null> {
	if (!(await acoustidReady().catch(() => false))) return null;
	const known = (await identifyFile(file).catch(() => [])).filter((c) => c.score >= 0.85);
	if (!known.length) return null;
	const names = target.artists?.length ? target.artists : [target.artist];
	const same = known.some(
		(c) =>
			similarity(target.title, c.title) >= 0.5 &&
			names.some(
				(a) => primaryArtist(a) === primaryArtist(c.artist) || similarity(a, c.artist) >= 0.5
			)
	);
	return same ? null : `its audio fingerprint is ${known[0].artist} — ${known[0].title}`;
}

/**
 * Find the same recording as a real lossless file on Soulseek and fetch it: several searches from
 * precise to wide, then a download that is checked against the audio itself. Returns null when
 * there is nothing suitable or every transfer failed — the caller then uses the other source.
 */
async function fetchLossless(
	t: Track,
	ctx: WorkerContext
): Promise<{ file: string; pick: SlskPick } | null> {
	ctx.stage('matching');
	const target = await soulseekTarget(t);
	checkAbort(ctx.signal);
	ctx.log(
		`Looking on Soulseek for a lossless copy of "${target.artist} - ${target.title}"` +
			(target.album
				? ` (album ${target.album}${target.trackNumber ? `, track ${target.trackNumber}` : ''})`
				: '')
	);

	const album = baseAlbum(target.album);
	const albumKey = album ? `${normalize(target.artist)}|${normalize(album)}` : null;
	const prefer = albumKey ? (albumSources.get(albumKey) ?? null) : null;
	let plan = searchPlan(target);
	// A folder is known to hold this album: look there first
	if (prefer)
		plan = [...plan].sort(
			(a, b) => Number(b.label.includes('album')) - Number(a.label.includes('album'))
		);

	const tried = new Set<string>();
	for (const [i, step] of plan.entries()) {
		checkAbort(ctx.signal);
		ctx.stage('matching');
		let report: MatchReport;
		try {
			const hits = await soulseek.search(step.query, { reuseMs: REUSE_SEARCH_MS });
			report = matchLossless(hits, target, {
				freeOnly: true,
				maxBytes: MAX_SOULSEEK_BYTES,
				exclude: tried,
				prefer,
				preferHiRes: getSettings().soulseek.preferHiRes
			});
			ctx.log(
				`Soulseek search ${i + 1}/${plan.length} (${step.label}) "${step.query}": ${hits.length} results, ${describeReport(report)}` +
					(report.picks.length
						? ` → ${report.picks.length} match${report.picks.length === 1 ? '' : 'es'}`
						: '')
			);
		} catch (err) {
			checkAbort(ctx.signal);
			ctx.log(`Soulseek search failed: ${(err as Error).message}`);
			return null;
		}

		for (const pick of report.picks) {
			if (tried.size >= AUTO_TRIES) break;
			checkAbort(ctx.signal);
			tried.add(`${pick.user}\u0000${pick.ref.file}`);
			ctx.stage('downloading');
			ctx.log(
				`Soulseek match ${Math.round(pick.score * 100)}% (${['title', ...pick.evidence].join(', ')}): ${pick.user} — ${pick.name}`
			);
			try {
				const file = await downloadSoulseek(t.id, pick.ref, ctx, AUTO_WAIT_MS);
				// Trust the audio, not the file name: lossless, the right length, the right recording
				const props = (await readMetadata(file).catch(() => null))?.properties;
				const ms = props ? Math.round((props.durationMs ?? props.duration * 1000) || 0) : 0;
				const problem = !props?.isLossless
					? 'not lossless audio'
					: target.durationMs && ms && Math.abs(ms - target.durationMs) > 7000
						? `length differs (${Math.round(ms / 1000)}s, expected ${Math.round(target.durationMs / 1000)}s)`
						: await fingerprintProblem(file, target);
				if (!problem) {
					if (albumKey) {
						albumSources.delete(albumKey);
						albumSources.set(albumKey, { user: pick.user, dir: pick.dir });
						if (albumSources.size > 200) albumSources.delete(albumSources.keys().next().value!);
					}
					return { file, pick };
				}
				ctx.log(`Rejected ${pick.name}: ${problem}`);
			} catch (err) {
				if (ctx.signal.aborted) throw err;
				ctx.log(`Soulseek transfer failed: ${(err as Error).message}`);
			}
			cleanupStaging(t.id);
		}
		if (tried.size >= AUTO_TRIES) break;
	}
	ctx.log('No usable lossless copy on Soulseek');
	return null;
}

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

	// 3 + 4. Find and download the audio -------------------------------------------------
	const preset = (
		t.formatPreset in FORMAT_PRESETS ? t.formatPreset : settings.pipeline.formatPreset
	) as FormatPresetId;
	const fromSoulseek = t.provider === 'soulseek';
	// The file came from a peer (picked by hand or found automatically), not from YouTube
	let viaSoulseek = fromSoulseek;

	/** Match a Spotify track to an upload when needed, then download it with yt-dlp. */
	const fromYouTube = async () => {
		if (t.provider === 'spotify') {
			ctx.stage('matching');
			ctx.log(`Searching YouTube for "${t.artist} - ${t.title}"`);
			const match = await findMatch(
				{
					title: t.title!,
					artist: t.artist!,
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
		ctx.stage('downloading');
		return downloadAudio(t.matchUrl!, t.id, preset, {
			signal: ctx.signal,
			onProgress: ctx.progress,
			onPostprocess: () => ctx.stage('processing'),
			onLog: ctx.log
		});
	};
	/** Record that the file came from a peer. */
	const useLossless = ({ file, pick }: { file: string; pick: SlskPick }) => {
		viaSoulseek = true;
		update({
			matchUrl: encodeRef(pick.ref),
			matchTitle: `${pick.user}: ${pick.name}`,
			matchScore: pick.score
		});
		return file;
	};

	let file: string;
	try {
		if (fromSoulseek) {
			const ref = decodeRef(t.matchUrl);
			if (!ref) throw new PermanentError('Missing Soulseek file reference');
			ctx.stage('downloading');
			file = await downloadSoulseek(t.id, ref, ctx);
		} else {
			// The preferred source goes first and the other one is the fallback
			const slsk = soulseek.status();
			const soulseekReady = slsk.enabled && slsk.configured;
			const soulseekFirst = soulseekReady && settings.pipeline.preferredSource === 'soulseek';
			const lossless = soulseekFirst ? await fetchLossless(t, ctx) : null;
			if (lossless) file = useLossless(lossless);
			else {
				if (soulseekFirst) ctx.log('Falling back to YouTube');
				try {
					file = await fromYouTube();
				} catch (err) {
					if (ctx.signal.aborted || soulseekFirst || !soulseekReady) throw err;
					cleanupStaging(t.id);
					ctx.log(`YouTube failed: ${(err as Error).message}`);
					ctx.log('Falling back to Soulseek');
					const alt = await fetchLossless(t, ctx);
					if (!alt) throw err;
					file = useLossless(alt);
				}
			}
		}
	} catch (err) {
		cleanupStaging(t.id);
		throw err;
	}

	try {
		// 5. Tag -------------------------------------------------------------------------
		ctx.stage('tagging');
		// A shared file usually carries proper tags already: they beat the guess made from its path.
		let embeddedArt = false;
		if (viaSoulseek) {
			const own = await readMetadata(file).catch(() => null);
			if (!own?.properties) throw new PermanentError('Downloaded file is not readable audio');
			embeddedArt = !!own.hasCoverArt;
			const { tags, properties } = own;
			// A file picked by hand is filed by its own tags. One found for a known track keeps
			// that track's metadata.
			const fileTags = {
				album: first(tags.album),
				albumArtist: first(tags.albumArtist),
				trackNumber: int(tags.track),
				discNumber: int(tags.discNumber),
				year: int(tags.year),
				genre: tags.genre?.length ? tags.genre.join('; ') : null
			};
			if (fromSoulseek) {
				update({
					title: first(tags.title) ?? t.title,
					artist: first(tags.artist) ?? t.artist,
					artists: tags.artist?.length ? tags.artist : t.artists,
					album: fileTags.album ?? t.album,
					albumArtist: fileTags.albumArtist ?? t.albumArtist,
					trackNumber: fileTags.trackNumber ?? t.trackNumber,
					discNumber: fileTags.discNumber ?? t.discNumber,
					year: fileTags.year ?? t.year,
					genre: fileTags.genre ?? t.genre,
					durationMs: Math.round((properties.durationMs ?? properties.duration * 1000) || 0) || null
				});
			} else {
				update({
					album: t.album ?? fileTags.album,
					albumArtist: t.albumArtist ?? fileTags.albumArtist,
					trackNumber: t.trackNumber ?? fileTags.trackNumber,
					discNumber: t.discNumber ?? fileTags.discNumber,
					year: t.year ?? fileTags.year,
					genre: t.genre ?? fileTags.genre
				});
			}
			ctx.log(
				`${properties.codec ?? path.extname(file).slice(1)} · ${properties.isLossless ? 'lossless' : `${properties.bitrate ?? '?'} kbps`}${properties.sampleRate ? ` · ${properties.bitsPerSample ? `${properties.bitsPerSample}-bit / ` : ''}${properties.sampleRate / 1000} kHz` : ''}`
			);
		}
		// MusicBrainz: studio album, track numbers, original year, genres and real cover art.
		// Spotify's own album info (when present) stays authoritative; YouTube uploads only know
		// the video, so MusicBrainz decides the album for those.
		let mbMatch: Enrichment | null = null;
		if (settings.pipeline.enrichMusicBrainz) {
			const keepAlbum = (t.provider === 'spotify' || fromSoulseek) && !!t.album;
			mbMatch = await enrich(
				{
					artist: t.artist,
					title: t.title,
					durationMs: t.durationMs,
					album: keepAlbum ? t.album : null,
					file
				},
				ctx.log
			).catch((err: Error) => {
				ctx.log(`MusicBrainz lookup failed: ${err.message}`);
				return null;
			});
			if (mbMatch) update(applyEnrichment(t, mbMatch, { keepAlbum }));
		}
		checkAbort(ctx.signal);
		const durationSec = t.durationMs ? t.durationMs / 1000 : null;
		let lyrics: Awaited<ReturnType<typeof fetchLyrics>> = null;
		if (settings.lyrics.enabled) {
			lyrics = await fetchLyrics({ artist: t.artist, title: t.title, album: t.album, durationSec });
			ctx.log(lyrics ? `Lyrics found (${lyrics.synced ? 'synced' : 'plain'})` : 'No lyrics found');
		}
		const lyricText = settings.lyrics.preferSynced
			? (lyrics?.synced ?? lyrics?.plain)
			: (lyrics?.plain ?? lyrics?.synced);

		// File the track with the album the library already has: one album artist, one release ID
		const identity = albumIdentity({
			albumArtist: t.albumArtist,
			artist: t.artists?.[0] ?? t.artist,
			album: t.album,
			releaseId: mbMatch && sameAlbum(mbMatch.album, t.album) ? mbMatch.releaseId : null
		});
		update({ albumArtist: identity.albumArtist, album: identity.album });

		await writeTags(file, {
			title: t.title,
			artists: t.artists?.length ? t.artists : [t.artist],
			album: t.album ?? undefined,
			albumArtist: t.albumArtist ?? t.artists?.[0] ?? t.artist,
			year: t.year ?? undefined,
			trackNumber: t.trackNumber ?? undefined,
			discNumber: t.discNumber ?? undefined,
			trackTotal:
				mbMatch && sameAlbum(mbMatch.album, t.album)
					? (mbMatch.trackTotal ?? undefined)
					: undefined,
			genre: splitGenres(t.genre),
			comment: viaSoulseek ? undefined : (t.matchUrl ?? undefined),
			lyrics: lyricText ?? undefined,
			mbRecordingId: mbMatch?.recordingId,
			mbReleaseId: identity.releaseId ?? undefined,
			mbArtistId: mbMatch?.artistId ?? undefined
		});

		// Art already embedded in a shared file is kept; a cover is only fetched when it has none.
		let hasArtwork = embeddedArt;
		if (t.artworkUrl && !embeddedArt) {
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
		const dest = moveFile(file, uniquePath(path.join(settings.paths.libraryDir, `${rel}.${ext}`)));
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
				bitsPerSample: meta.properties?.bitsPerSample || null,
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
				mbReleaseId: first(meta.tags.musicbrainzReleaseId),
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

/**
 * rename(), falling back to copy+unlink across filesystems (staging on SSD, library on HDD).
 * Returns the path as it exists on disk: on case-insensitive filesystems (macOS) "System of a
 * Down/…" lands inside an existing "System Of A Down/" folder, and the index must record that.
 */
export function moveFile(from: string, to: string): string {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	try {
		fs.renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		fs.copyFileSync(from, to);
		fs.rmSync(from);
	}
	return trueCasePath(to);
}

/**
 * The path with each segment spelled the way it exists on disk. On case-insensitive filesystems
 * "System of a Down/Toxicity" may really be the existing "System Of A Down/Toxicity" folder, and
 * the index must record what a directory walk will report. (No symlink resolution, unlike realpath.)
 */
export function trueCasePath(p: string): string {
	const parts = p.split(path.sep);
	let cur = parts[0] === '' ? path.sep : '.';
	for (const part of parts[0] === '' ? parts.slice(1) : parts) {
		if (!part) continue;
		let entries: string[] = [];
		try {
			entries = fs.readdirSync(cur);
		} catch {
			/* unreadable: keep the given spelling */
		}
		const real = entries.includes(part)
			? part
			: entries.find((e) => e.toLowerCase() === part.toLowerCase());
		cur = path.join(cur, real ?? part);
	}
	return path.isAbsolute(p) ? cur : path.relative('.', cur);
}

/** Two paths name the same existing file (true for case-only differences on macOS). */
export function samePath(a: string, b: string) {
	try {
		return fs.realpathSync.native(a) === fs.realpathSync.native(b);
	} catch {
		return false;
	}
}
