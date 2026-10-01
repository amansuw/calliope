import { fileParts, guessTags, type SlskHit, type SlskRef } from '$lib/soulseek';
import { cleanTitle, normalize, similarity, tokens } from '$lib/text';
import { durationScore, VARIANTS, type MatchTarget } from './score';

/** What is known about the wanted recording. Album and track number widen and sharpen the search. */
export interface SlskTarget extends MatchTarget {
	album?: string | null;
	trackNumber?: number | null;
}

export interface SlskPick {
	ref: SlskRef;
	user: string;
	name: string;
	/** Folder the file sits in on the peer */
	dir: string;
	score: number;
	freeSlot: boolean;
	/** What backed the match besides the title, for the log */
	evidence: string[];
}

export interface SlskQuery {
	label: string;
	query: string;
}

export interface MatchReport {
	picks: SlskPick[];
	/** Lossless files looked at */
	lossless: number;
	/** Why the others were turned down, by reason */
	rejected: Record<string, number>;
	/** Good matches that were skipped only because the peer has a queue */
	busy: number;
}

const LOSSLESS = new Set(['flac']);
const MIN_BYTES = 2 * 1024 * 1024;
/** No 16-bit FLAC averages this much: CD audio is only 1411 kbps before compression. */
const HI_RES_KBPS = 1500;

/** Above CD quality, going by what the peer reports or, failing that, a size no CD rip reaches. */
function isHiRes(h: SlskHit): boolean {
	const rate = h.attribs[4];
	const depth = h.attribs[5];
	if (rate || depth) return (depth ?? 16) > 16 || (rate ?? 44100) > 48000;
	const sec = h.attribs[1];
	return !!sec && (h.size * 8) / sec / 1000 > HI_RES_KBPS;
}

const words = (s: string) =>
	normalize(s)
		.split(' ')
		.filter((w) => w.length > 1);
const firstArtist = (t: SlskTarget) => t.artists?.[0] ?? t.artist;
/** "Song ft. Someone (Official Video)" → "Song": upload decorations and guest credits removed. */
export const plainTitle = (title: string) =>
	cleanTitle(title)
		.replace(/\s*[([]\s*(?:feat|ft|with)\b\.?[^)\]]*[)\]]/gi, '')
		.replace(/\s+(?:feat|ft)\b\.?\s.*$/i, '')
		.trim() || title;

/** "Cracker Island (Deluxe)" → "Cracker Island": folders rarely carry the edition the same way. */
export const baseAlbum = (album: string | null | undefined) =>
	album ? album.replace(/(\s*[([][^)\]]*[)\]])+\s*$/, '').trim() || album : null;
/** Too short or too common to search for on its own ("Oil", "Go", "Home"). */
const distinctive = (w: string[]) => w.length >= 2 || (w[0]?.length ?? 0) >= 8;

/**
 * The searches to try, in order. Soulseek only returns files whose path contains every word, and
 * shared files are named inconsistently: many carry no artist, and some only match by their
 * album folder. So after the precise search come wider ones, which the matcher checks harder.
 */
export function searchPlan(target: SlskTarget): SlskQuery[] {
	const artist = words(firstArtist(target));
	const title = words(cleanTitle(target.title));
	const album = words(baseAlbum(target.album) ?? '');
	const plan: SlskQuery[] = [{ label: 'artist + title', query: [...artist, ...title].join(' ') }];
	if (distinctive(title)) plan.push({ label: 'title only', query: title.join(' ') });
	else if (album.length)
		plan.push({ label: 'title + album', query: [...new Set([...title, ...album])].join(' ') });
	if (album.length) {
		plan.push({ label: 'artist + album', query: [...artist, ...album].join(' ') });
		if (distinctive(album)) plan.push({ label: 'album only', query: album.join(' ') });
	}
	const seen = new Set<string>();
	return plan.filter((p) => p.query && !seen.has(p.query) && !!seen.add(p.query));
}

/** Share of `needle`'s words found in `hay`. */
const coverage = (needle: string | null | undefined, hay: Set<string>) => {
	const t = [...tokens(needle)];
	return t.length ? t.filter((x) => hay.has(x)).length / t.length : 0;
};

/**
 * Lossless files that are the wanted recording, best first, plus why the rest were turned down.
 *
 * The title must match. Beyond that a file needs backing: the artist somewhere in its path, or —
 * for files shared without an artist name — the right length together with the album folder or
 * track number. A reported length that is far off always rejects.
 */
export function matchLossless(
	hits: SlskHit[],
	target: SlskTarget,
	opts: {
		minScore?: number;
		freeOnly?: boolean;
		maxBytes?: number;
		/** Files already tried */
		exclude?: Set<string>;
		/** Folder that already delivered a track of this album: its files go first */
		prefer?: { user: string; dir: string } | null;
		/** Between equally good matches, take the copy above CD quality instead of the CD rip */
		preferHiRes?: boolean;
	} = {}
): MatchReport {
	const minScore = opts.minScore ?? 0.7;
	const targetNorm = ` ${normalize(target.title)} `;
	const artistNames = target.artists?.length ? target.artists : [target.artist];
	const album = baseAlbum(target.album);
	const rejected: Record<string, number> = {};
	const reject = (why: string) => void (rejected[why] = (rejected[why] ?? 0) + 1);
	const scored: (SlskPick & {
		hiRes: boolean;
		speed: number;
		queue: number;
		preferred: boolean;
	})[] = [];
	const seen = new Set<string>();
	let lossless = 0;
	let busy = 0;

	for (const h of hits) {
		const { name, ext, dir } = fileParts(h.file);
		if (!LOSSLESS.has(ext)) continue;
		const id = `${h.user}\u0000${h.file}`;
		if (seen.has(id) || opts.exclude?.has(id)) continue;
		seen.add(id);
		lossless++;
		if (h.size < MIN_BYTES || (opts.maxBytes && h.size > opts.maxBytes)) {
			reject('unusual size');
			continue;
		}

		const guess = guessTags(h.file);
		const titleSim = Math.max(
			similarity(target.title, guess.title),
			similarity(cleanTitle(target.title), guess.title)
		);
		if (titleSim < 0.6) {
			reject('another title');
			continue;
		}

		const pathTokens = tokens(h.file.replace(/[\\/_.]+/g, ' '));
		const dirTokens = tokens(dir.replace(/[\\/_.]+/g, ' '));
		const artistSim = Math.max(0, ...artistNames.map((a) => coverage(a, pathTokens)));
		const albumSim = coverage(album, dirTokens);
		const trackOk = !!target.trackNumber && guess.trackNumber === target.trackNumber;

		const durationSec = h.attribs[1] ?? null;
		const dur = durationScore(target.durationMs, durationSec);
		const offBy = dur === null ? null : Math.abs(target.durationMs! / 1000 - durationSec!);
		if (offBy !== null && offBy > 12) {
			reject('wrong length');
			continue;
		}
		const lengthOk = offBy !== null && offBy <= 3;

		const hasArtist = artistSim >= 0.5;
		const hasAlbum = albumSim >= 0.8;
		// Without the artist in the path, a title is not enough: plenty of songs share one
		if (!hasArtist && !(lengthOk && (hasAlbum || trackOk))) {
			reject('artist not confirmed');
			continue;
		}

		// With no artist in the path, the album folder or track number stands in for it
		const who = hasArtist ? artistSim : hasAlbum ? 0.9 : 0.75;
		let score =
			dur === null ? 0.55 * titleSim + 0.45 * who : 0.35 * titleSim + 0.25 * who + 0.4 * dur;
		const pathNorm = ` ${normalize(h.file.replace(/[\\/_.]+/g, ' '))} `;
		let variant = false;
		for (const v of VARIANTS) {
			if (pathNorm.includes(` ${v} `) && !targetNorm.includes(` ${v} `)) {
				score -= 0.4;
				variant = true;
			}
		}
		// Without a length to check against, the name alone is weaker evidence
		if (dur === null) score -= 0.1;
		if (score < minScore) {
			reject(variant ? 'another version (live, remix…)' : 'weak match');
			continue;
		}
		if (opts.freeOnly && !h.slots) {
			busy++;
			continue;
		}

		const evidence = [
			hasArtist && 'artist',
			hasAlbum && 'album',
			trackOk && 'track number',
			lengthOk && 'length'
		].filter((e): e is string => !!e);
		scored.push({
			ref: { user: h.user, file: h.file, size: h.size },
			user: h.user,
			name,
			dir,
			score: Math.min(1, score),
			freeSlot: h.slots,
			evidence,
			hiRes: isHiRes(h),
			speed: h.speed ?? 0,
			queue: h.queueLength ?? 0,
			preferred: !!opts.prefer && opts.prefer.user === h.user && opts.prefer.dir === dir
		});
	}

	const bucket = (s: number) => Math.round(s * 20);
	const picks = scored
		.sort(
			(a, b) =>
				Number(b.preferred) - Number(a.preferred) ||
				bucket(b.score) - bucket(a.score) ||
				(opts.preferHiRes ? Number(b.hiRes) - Number(a.hiRes) : 0) ||
				b.evidence.length - a.evidence.length ||
				Number(b.freeSlot) - Number(a.freeSlot) ||
				Number(a.hiRes) - Number(b.hiRes) ||
				a.queue - b.queue ||
				b.speed - a.speed
		)
		.map(({ ref, user, name, dir, score, freeSlot, evidence }) => ({
			ref,
			user,
			name,
			dir,
			score,
			freeSlot,
			evidence
		}));
	return { picks, lossless, rejected, busy };
}

/** One line for the log: what a search turned up and why nothing was usable. */
export function describeReport(r: MatchReport): string {
	const reasons = Object.entries(r.rejected)
		.sort((a, b) => b[1] - a[1])
		.map(([why, n]) => `${n} ${why}`);
	if (r.busy) reasons.unshift(`${r.busy} on busy peers`);
	return `${r.lossless} lossless file${r.lossless === 1 ? '' : 's'}${reasons.length ? ` — ${reasons.join(', ')}` : ''}`;
}
