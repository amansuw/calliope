/**
 * MusicBrainz enrichment: turn "artist + title (+ duration)" into album-level metadata —
 * the original studio album, track/disc numbers, original release year, community genres and
 * the album's cover art.
 */
import { normalize, primaryArtist, similarity } from '$lib/text';
import { VARIANTS } from './sources/score';
import { titleCase } from '$lib/studio-transforms';
import {
	artistGenres,
	findCoverArt,
	releaseGroupDetails,
	searchRecordings,
	type MbCandidate,
	type MbGenre,
	type MbRelease
} from './studio/musicbrainz';
import { acoustidReady, identifyFile } from './studio/acoustid';

export interface Enrichment {
	title: string;
	artist: string;
	artists: string[];
	album: string | null;
	albumArtist: string | null;
	year: number | null;
	trackNumber: number | null;
	trackTotal: number | null;
	discNumber: number | null;
	genres: string[];
	artworkUrl: string | null;
	recordingId: string;
	releaseId: string | null;
	releaseGroupId: string | null;
	artistId: string | null;
	/** Identified by audio fingerprint (AcoustID) rather than by tags */
	verified: boolean;
	confidence: number;
}

export interface EnrichQuery {
	artist: string;
	title: string;
	durationMs?: number | null;
	album?: string | null;
	/** Audio file to fingerprint; enables AcoustID identification when configured */
	file?: string | null;
}

/** MusicBrainz uses typographic punctuation (‐ ’ “ ”); files and searches are friendlier in ASCII. */
export function asciiPunctuation(s: string): string {
	return s.replace(/[‐‑]/g, '-').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"').replace(/…/g, '...');
}

/** Releases that are live/session recordings even when MusicBrainz doesn't type them as such. */
const LIVE_TITLE = /\b(?:live(?: at| in| from)?|unplugged|in concert|sessions?|bbc|mtv)\b/i;

const isStudioAlbum = (r: MbRelease) =>
	r.status === 'Official' &&
	r.primaryType === 'Album' &&
	!r.secondaryTypes.length &&
	!LIVE_TITLE.test(r.title);

export type ReleaseKind =
	'album' | 'ep' | 'single' | 'soundtrack' | 'compilation' | 'live' | 'bootleg' | 'other';

export function releaseKind(r: MbRelease): ReleaseKind {
	const sec = r.secondaryTypes.map((t) => t.toLowerCase());
	if (r.status === 'Bootleg') return 'bootleg';
	if (sec.includes('live') || LIVE_TITLE.test(r.title)) return 'live';
	if (sec.includes('compilation') || sec.includes('dj-mix') || sec.includes('mixtape/street'))
		return 'compilation';
	if (sec.includes('soundtrack')) return 'soundtrack';
	if (r.primaryType === 'Album') return 'album';
	if (r.primaryType === 'EP') return 'ep';
	if (r.primaryType === 'Single') return 'single';
	return 'other';
}

const KIND_WEIGHT: Record<ReleaseKind, number> = {
	album: 1,
	ep: 0.7,
	single: 0.6,
	soundtrack: 0.5,
	compilation: 0.35,
	other: 0.3,
	live: 0.2,
	bootleg: 0.1
};

const hasVariantMismatch = (qTitle: string, cTitle: string) => {
	const qt = ` ${normalize(qTitle)} `;
	const ct = ` ${normalize(cTitle)} `;
	return VARIANTS.some((v) => ct.includes(` ${v} `) && !qt.includes(` ${v} `));
};

/**
 * How sure we are that this recording on this release is the right tag source (0..1).
 * MusicBrainz's own search score is text relevance only — every same-titled recording scores
 * 100 — so this weighs title, artist, duration and what kind of release it is. A fingerprint
 * match settles identity, leaving only the choice of release.
 */
export function matchConfidence(
	q: EnrichQuery,
	c: MbCandidate,
	r: MbRelease | null,
	verified: boolean
): number {
	const kind = r ? KIND_WEIGHT[releaseKind(r)] : 0.3;
	if (verified) return Math.round(Math.min(1, 0.55 + 0.25 * c.score + 0.2 * kind) * 100) / 100;
	let title = similarity(q.title, c.title);
	if (hasVariantMismatch(q.title, c.title)) title *= 0.5;
	const artist =
		primaryArtist(q.artist) === primaryArtist(c.artist) ? 1 : similarity(q.artist, c.artist);
	const dur =
		q.durationMs && c.durationMs
			? Math.max(0, Math.min(1, 1 - (Math.abs(q.durationMs - c.durationMs) - 2000) / 20_000))
			: 0.6;
	return Math.round((0.3 * title + 0.2 * artist + 0.25 * dur + 0.25 * kind) * 100) / 100;
}

/**
 * AcoustID's database has wrong submissions (a fingerprint linked to an unrelated song), so a
 * fingerprint hit only counts when it's plausibly the same song as the file's tags. Files without
 * meaningful tags (no artist, "Unknown Artist", "track01") trust the fingerprint outright.
 */
export function acousticPlausible(
	q: Pick<EnrichQuery, 'artist' | 'title'>,
	c: MbCandidate
): boolean {
	const artist = (q.artist ?? '').trim();
	if (!artist || /^unknown( artist)?$/i.test(artist)) return true;
	const artistOk =
		primaryArtist(q.artist) === primaryArtist(c.artist) || similarity(q.artist, c.artist) >= 0.5;
	const titleOk = !!q.title && similarity(q.title, c.title) >= 0.5;
	return artistOk || titleOk;
}

/** Acoustic matches are the same audio; prefer the canonical studio-album recording. */
export function pickAcoustic(
	q: Pick<EnrichQuery, 'artist' | 'title'>,
	candidates: MbCandidate[]
): MbCandidate | null {
	const ok = candidates.filter((c) => c.score >= 0.85 && acousticPlausible(q, c));
	ok.sort(
		(a, b) =>
			Number(b.releases.some(isStudioAlbum)) - Number(a.releases.some(isStudioAlbum)) ||
			b.score - a.score
	);
	return ok[0] ?? null;
}

/**
 * Choose the recording that is really this song. Rejects different songs (title/artist) and
 * different cuts (duration), then prefers recordings that appear on a proper studio album.
 */
export function pickCandidate(q: EnrichQuery, candidates: MbCandidate[]): MbCandidate | null {
	const qArtist = primaryArtist(q.artist);
	const ok = candidates.filter((c) => {
		if (similarity(q.title, c.title) < 0.7) return false;
		// "Song (instrumental)" / "(live)" / "(remix)" are different recordings unless asked for
		const qt = ` ${normalize(q.title)} `;
		const ct = ` ${normalize(c.title)} `;
		if (VARIANTS.some((v) => ct.includes(` ${v} `) && !qt.includes(` ${v} `))) return false;
		const cArtist = primaryArtist(c.artist);
		if (qArtist !== cArtist && similarity(q.artist, c.artist) < 0.6) return false;
		// Music-video edits and radio cuts often differ from the album version by 10–20s
		if (q.durationMs && c.durationMs) {
			const tolerance = Math.max(15_000, q.durationMs * 0.1);
			if (Math.abs(q.durationMs - c.durationMs) > tolerance) return false;
		}
		return c.score >= 0.8;
	});
	const diff = (c: MbCandidate) =>
		q.durationMs && c.durationMs ? Math.abs(q.durationMs - c.durationMs) : 5_000;
	ok.sort(
		(a, b) =>
			Number(b.releases.some(isStudioAlbum)) - Number(a.releases.some(isStudioAlbum)) ||
			diff(a) - diff(b) ||
			b.score - a.score
	);
	return ok[0] ?? null;
}

/** The release to take album/track info from: earliest official studio album, else best ranked. */
export function pickRelease(c: MbCandidate, preferAlbum?: string | null): MbRelease | null {
	if (preferAlbum) {
		const named = c.releases.find((r) => normalize(r.title) === normalize(preferAlbum));
		if (named) return named;
	}
	const albums = c.releases
		.filter(isStudioAlbum)
		.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
	return albums[0] ?? c.releases[0] ?? null;
}

/**
 * Top community genres, most-voted first. Drops weakly voted ones and generic parents when a
 * more specific genre is present ("metal" when "nu metal" is there).
 */
export function pickGenres(genres: MbGenre[], max = 3): string[] {
	const sorted = [...genres].sort((a, b) => b.count - a.count);
	const top = sorted[0]?.count ?? 0;
	const strong = sorted
		.filter((g) => g.count >= Math.max(1, top * 0.25))
		.map((g) => g.name.toLowerCase());
	const specific = strong.filter(
		(g) => !strong.some((o) => o !== g && (o.endsWith(` ${g}`) || o.endsWith(`-${g}`)))
	);
	return specific.slice(0, max).map(titleCase);
}

/** Year (original release), genres and cover art for a chosen release. */
export async function releaseExtras(
	release: Pick<MbRelease, 'id' | 'releaseGroupId' | 'year'>,
	artistId: string | null
) {
	const rgId = release.releaseGroupId;
	let year = release.year ?? null;
	let genres: string[] = [];
	if (rgId) {
		const rg = await releaseGroupDetails(rgId).catch(() => null);
		if (rg?.firstReleaseDate) year = Number(rg.firstReleaseDate.slice(0, 4)) || year;
		genres = pickGenres(rg?.genres ?? []);
	}
	if (!genres.length && artistId) genres = pickGenres(await artistGenres(artistId).catch(() => []));
	const artworkUrl = await findCoverArt(release.id, rgId, 'release-group');
	return { year, genres, artworkUrl };
}

const acousticReadySafe = () => acoustidReady().catch(() => false);

async function tryAcoustic(q: EnrichQuery, log: (line: string) => void): Promise<MbCandidate[]> {
	if (!q.file || !(await acoustidReady())) return [];
	try {
		return await identifyFile(q.file);
	} catch (err) {
		log(`AcoustID lookup failed: ${(err as Error).message}`);
		return [];
	}
}

/**
 * Clean title, artists, album and track number for a song known only by rough text (a video
 * title, say). Text search only and no extras: cheap enough to run before looking for a file.
 */
export async function identifyRecording(q: Omit<EnrichQuery, 'file'>) {
	if (!q.artist || !q.title) return null;
	const query = { title: q.title, artist: q.artist, durationMs: q.durationMs };
	const pick =
		pickCandidate(q, await searchRecordings({ ...query, albumOnly: true })) ??
		pickCandidate(q, await searchRecordings(query));
	if (!pick) return null;
	const release = pickRelease(pick, q.album);
	return {
		title: asciiPunctuation(pick.title),
		artist: asciiPunctuation(pick.artist),
		artists: pick.artists.map(asciiPunctuation),
		album: release ? asciiPunctuation(release.title) : null,
		trackNumber: release?.trackNumber ?? null,
		durationMs: pick.durationMs
	};
}

export async function enrich(
	q: EnrichQuery,
	log: (line: string) => void = () => {}
): Promise<Enrichment | null> {
	if (!q.artist || !q.title) return null;
	let pick = pickAcoustic(q, await tryAcoustic(q, log));
	const verified = !!pick;
	if (pick) log(`AcoustID: audio fingerprint matched ${pick.artist} — ${pick.title}`);
	if (!pick) {
		const query = { title: q.title, artist: q.artist, durationMs: q.durationMs };
		pick = pickCandidate(q, await searchRecordings({ ...query, albumOnly: true }));
		if (!pick) pick = pickCandidate(q, await searchRecordings(query));
	}
	if (!pick) {
		log('MusicBrainz: no confident match');
		return null;
	}

	const release = pickRelease(pick, q.album);
	const extras = release
		? await releaseExtras(release, pick.artistId)
		: { year: null, genres: [], artworkUrl: null };
	const result: Enrichment = {
		title: asciiPunctuation(pick.title),
		artist: asciiPunctuation(pick.artist),
		artists: pick.artists.map(asciiPunctuation),
		album: release ? asciiPunctuation(release.title) : null,
		albumArtist: release?.albumArtist ? asciiPunctuation(release.albumArtist) : null,
		year: extras.year,
		trackNumber: release?.trackNumber ?? null,
		trackTotal: release?.trackCount ?? null,
		discNumber: release?.discNumber ?? null,
		genres: extras.genres,
		artworkUrl: extras.artworkUrl,
		recordingId: pick.recordingId,
		releaseId: release?.id ?? null,
		releaseGroupId: release?.releaseGroupId ?? null,
		artistId: pick.artistId,
		verified,
		confidence: matchConfidence(q, pick, release, verified)
	};
	log(
		`MusicBrainz: ${result.artist} — ${result.title} · ${result.album ?? 'no album'}${result.year ? ` (${result.year})` : ''}` +
			`${result.trackNumber ? ` #${result.trackNumber}` : ''}${result.genres.length ? ` · ${result.genres.join(', ')}` : ''}` +
			`${result.artworkUrl ? ' · cover art' : ''} · ${Math.round(result.confidence * 100)}%${verified ? ' (fingerprint)' : ''}`
	);
	return result;
}

export interface AlbumOption {
	key: string;
	recordingId: string;
	title: string;
	artist: string;
	artists: string[];
	artistId: string | null;
	durationMs: number | null;
	releaseId: string;
	releaseGroupId: string | null;
	album: string;
	albumArtist: string | null;
	year: number | null;
	country: string | null;
	trackNumber: number | null;
	trackTotal: number | null;
	discNumber: number | null;
	kind: ReleaseKind;
	confidence: number;
	verified: boolean;
	coverThumb: string;
}

/**
 * Every album a track could be tagged from, one entry per release group, ranked by confidence.
 * Used by the Studio so the user can pick (and see the cover of) the right album.
 */
export type AcousticStatus = 'matched' | 'no-match' | 'unavailable' | 'error';

export async function albumOptions(
	q: EnrichQuery,
	log: (line: string) => void = () => {},
	opts: { audioOnly?: boolean; onAcoustic?: (status: AcousticStatus) => void } = {}
): Promise<AlbumOption[]> {
	const ready = !!q.file && (await acousticReadySafe());
	if (opts.audioOnly && !ready) {
		throw new Error(
			'Identify audio needs Chromaprint (fpcalc) and an AcoustID application key — see Settings › Integrations'
		);
	}
	let failed = false;
	const acoustic = ready
		? await tryAcoustic(q, (l) => {
				failed = true;
				log(l);
			})
		: [];
	opts.onAcoustic?.(
		!ready ? 'unavailable' : failed ? 'error' : acoustic.length ? 'matched' : 'no-match'
	);
	const query = { title: q.title, artist: q.artist, durationMs: q.durationMs };
	const text = opts.audioOnly
		? []
		: [
				...(await searchRecordings({ ...query, albumOnly: true })),
				...(await searchRecordings(query))
			];
	const best = new Map<string, AlbumOption>();
	const add = (c: MbCandidate, verified: boolean) => {
		for (const r of c.releases) {
			const key = r.releaseGroupId ?? r.id;
			const confidence = matchConfidence(q, c, r, verified);
			const prev = best.get(key);
			// Within an album, prefer its earliest release (original track numbering)
			if (
				prev &&
				(prev.confidence > confidence ||
					(prev.confidence === confidence && (prev.year ?? 9999) <= (r.year ?? 9999)))
			)
				continue;
			best.set(key, {
				key,
				recordingId: c.recordingId,
				title: asciiPunctuation(c.title),
				artist: asciiPunctuation(c.artist),
				artists: c.artists.map(asciiPunctuation),
				artistId: c.artistId,
				durationMs: c.durationMs,
				releaseId: r.id,
				releaseGroupId: r.releaseGroupId,
				album: asciiPunctuation(r.title),
				albumArtist: r.albumArtist ? asciiPunctuation(r.albumArtist) : null,
				year: r.year,
				country: r.country,
				trackNumber: r.trackNumber,
				trackTotal: r.trackCount,
				discNumber: r.discNumber,
				kind: releaseKind(r),
				confidence,
				verified,
				coverThumb: r.releaseGroupId
					? `https://coverartarchive.org/release-group/${r.releaseGroupId}/front-250`
					: `https://coverartarchive.org/release/${r.id}/front-250`
			});
		}
	};
	// Implausible fingerprint hits (AcoustID data errors) are ranked like ordinary text results
	for (const c of acoustic.filter((c) => c.score >= 0.5)) add(c, acousticPlausible(q, c));
	for (const c of text) add(c, false);
	return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 30);
}

/** Same artist ignoring case/punctuation — safe to adopt MusicBrainz's canonical spelling. */
export const sameArtist = (a: string | null | undefined, b: string | null | undefined) =>
	!!a && !!b && normalize(a) === normalize(b);

export interface TagFields {
	title: string | null;
	artist: string | null;
	artists?: string[] | null;
	album: string | null;
	albumArtist: string | null;
	year: number | null;
	trackNumber: number | null;
	discNumber: number | null;
	genre: string | null;
	artworkUrl?: string | null;
}

/**
 * Merge an enrichment into existing tag values.
 * `keepAlbum`: the current album is authoritative (e.g. Spotify said which release this is),
 * so only fill gaps around it instead of switching to MusicBrainz's studio album.
 */
export function applyEnrichment(cur: TagFields, e: Enrichment, opts: { keepAlbum?: boolean } = {}) {
	const keep = !!opts.keepAlbum && !!cur.album;
	const artistOk =
		sameArtist(cur.artist, e.artist) || primaryArtist(cur.artist) === primaryArtist(e.artist);
	return {
		title: e.title,
		artist: artistOk ? e.artist : cur.artist,
		artists: artistOk ? e.artists : (cur.artists ?? null),
		album: keep ? cur.album : (e.album ?? cur.album),
		albumArtist: keep ? cur.albumArtist : (e.albumArtist ?? cur.albumArtist),
		year: keep && cur.year ? cur.year : (e.year ?? cur.year),
		trackNumber: keep && cur.trackNumber ? cur.trackNumber : (e.trackNumber ?? cur.trackNumber),
		discNumber: keep && cur.discNumber ? cur.discNumber : (e.discNumber ?? cur.discNumber),
		genre: cur.genre || e.genres.join('; ') || null,
		artworkUrl: keep && cur.artworkUrl ? cur.artworkUrl : (e.artworkUrl ?? cur.artworkUrl ?? null)
	};
}

/** Multi-value genre tag from the "A; B" form stored in the index. */
export const splitGenres = (g: string | null | undefined) =>
	g ? g.split(/\s*;\s*/).filter(Boolean) : undefined;
