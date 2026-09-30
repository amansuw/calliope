/**
 * MusicBrainz + Cover Art Archive client.
 * MusicBrainz allows ~1 request/second per client and requires a descriptive User-Agent.
 */
const MB = 'https://musicbrainz.org/ws/2';
const UA = 'Calliope/1.0 ( https://github.com/calliope-music )';

let chain: Promise<unknown> = Promise.resolve();
let last = 0;

/** Serialize MusicBrainz calls and space them ≥1.1s apart. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
	const next = chain.then(async () => {
		const wait = last + 1100 - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		last = Date.now();
		return fn();
	});
	chain = next.catch(() => {});
	return next;
}

async function mb<T>(path: string, params: Record<string, string>, attempt = 0): Promise<T> {
	const res = await throttled(() =>
		fetch(`${MB}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`, {
			headers: { 'User-Agent': UA, Accept: 'application/json' },
			signal: AbortSignal.timeout(20_000)
		})
	);
	// 503 = rate limited; back off once rather than failing a whole batch
	if (res.status === 503 && attempt < 2) {
		await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
		return mb<T>(path, params, attempt + 1);
	}
	if (res.status === 503) throw new Error('MusicBrainz is rate limiting — try again in a moment');
	if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
	return (await res.json()) as T;
}

export interface MbRelease {
	id: string;
	title: string;
	date: string | null;
	year: number | null;
	country: string | null;
	status: string | null;
	primaryType: string | null;
	secondaryTypes: string[];
	releaseGroupId: string | null;
	albumArtist: string | null;
	trackNumber: number | null;
	trackCount: number | null;
	discNumber: number | null;
}

export interface MbCandidate {
	recordingId: string;
	title: string;
	artist: string;
	artists: string[];
	artistId: string | null;
	durationMs: number | null;
	isrcs: string[];
	score: number;
	releases: MbRelease[];
	source: 'search' | 'acoustid';
}

type RawCredit = { name: string; joinphrase?: string; artist?: { id: string; name: string } }[];
interface RawRecording {
	id: string;
	title: string;
	length?: number;
	score?: number;
	isrcs?: string[];
	'artist-credit'?: RawCredit;
	releases?: {
		id: string;
		title: string;
		date?: string;
		country?: string;
		status?: string;
		'artist-credit'?: RawCredit;
		'release-group'?: { id: string; 'primary-type'?: string; 'secondary-types'?: string[] };
		media?: {
			position?: number;
			'track-count'?: number;
			track?: { number?: string; position?: number }[];
			'track-offset'?: number;
		}[];
	}[];
}

const credit = (c?: RawCredit) => (c ?? []).map((a) => a.name + (a.joinphrase ?? '')).join('');

export function toCandidate(
	r: RawRecording,
	source: MbCandidate['source'],
	score?: number
): MbCandidate {
	const releases: MbRelease[] = (r.releases ?? []).map((rel) => {
		const medium = rel.media?.[0];
		const t = medium?.track?.[0];
		const pos =
			t?.position ??
			(Number(t?.number) || (medium?.['track-offset'] != null ? medium['track-offset'] + 1 : null));
		return {
			id: rel.id,
			title: rel.title,
			date: rel.date ?? null,
			year: rel.date ? Number(rel.date.slice(0, 4)) || null : null,
			country: rel.country ?? null,
			status: rel.status ?? null,
			primaryType: rel['release-group']?.['primary-type'] ?? null,
			secondaryTypes: rel['release-group']?.['secondary-types'] ?? [],
			releaseGroupId: rel['release-group']?.id ?? null,
			albumArtist: rel['artist-credit'] ? credit(rel['artist-credit']) : null,
			trackNumber: pos ?? null,
			trackCount: medium?.['track-count'] ?? null,
			discNumber: medium?.position ?? null
		};
	});
	// Official albums first, compilations and bootlegs last, then earliest date
	const rank = (r: MbRelease) =>
		(r.status === 'Official' ? 0 : 2) +
		(r.primaryType === 'Album' ? 0 : r.primaryType === 'Single' || r.primaryType === 'EP' ? 1 : 2) +
		(r.secondaryTypes.length ? 3 : 0);
	releases.sort((a, b) => rank(a) - rank(b) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));
	return {
		recordingId: r.id,
		title: r.title,
		artist: credit(r['artist-credit']),
		artists: (r['artist-credit'] ?? []).map((a) => a.name),
		artistId: r['artist-credit']?.[0]?.artist?.id ?? null,
		durationMs: r.length ?? null,
		isrcs: r.isrcs ?? [],
		score: score ?? (r.score ?? 0) / 100,
		releases,
		source
	};
}

const esc = (s: string) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

export interface RecordingQuery {
	artist?: string | null;
	title: string;
	album?: string | null;
	durationMs?: number | null;
	/** Only recordings that appear on official studio albums (no live/compilation releases) */
	albumOnly?: boolean;
}

export async function searchRecordings(q: RecordingQuery): Promise<MbCandidate[]> {
	const parts = [`recording:"${esc(q.title)}"`];
	if (q.artist) parts.push(`artist:"${esc(q.artist)}"`);
	const base = parts.length;
	if (q.album) parts.push(`release:"${esc(q.album)}"`);
	// No `dur:` filter: video edits and radio cuts differ from the album version by 10–20s, and
	// a ±5s window silently drops the album recording. Duration is weighed when ranking instead.
	// Only positive filters: MusicBrainz evaluates release fields across *all* of a recording's
	// releases, so "NOT secondarytype:compilation" would drop a studio-album recording just
	// because it also appears on a Now That's What I Call Music. Live/compilation releases are
	// ranked down afterwards instead.
	const filters = q.albumOnly ? ' AND status:official AND primarytype:album' : '';
	// Popular songs sit on dozens of compilations; fetch deep enough to reach the album recording
	const limit = q.albumOnly ? '100' : '25';
	let data = await mb<{ recordings: RawRecording[] }>('/recording', {
		query: parts.join(' AND ') + filters,
		limit
	});
	// Album/duration constraints can be too strict for mis-tagged files: relax once.
	if (!data.recordings.length && parts.length > base) {
		data = await mb<{ recordings: RawRecording[] }>('/recording', {
			query: parts.slice(0, base).join(' AND ') + filters,
			limit
		});
	}
	const out = data.recordings.map((r) => toCandidate(r, 'search'));
	// MB scores tie a lot (many 100s); break ties by closeness to the file's duration.
	const diff = (c: MbCandidate) =>
		q.durationMs && c.durationMs ? Math.abs(c.durationMs - q.durationMs) : 60_000;
	return out.sort((a, b) => b.score - a.score || diff(a) - diff(b));
}

export interface MbGenre {
	name: string;
	count: number;
}

/** Release group details: original release date and community genres. */
export async function releaseGroupDetails(id: string) {
	const rg = await mb<{
		id: string;
		title: string;
		'first-release-date'?: string;
		'primary-type'?: string;
		genres?: MbGenre[];
	}>(`/release-group/${id}`, { inc: 'genres' });
	return {
		id: rg.id,
		title: rg.title,
		firstReleaseDate: rg['first-release-date'] || null,
		genres: rg.genres ?? []
	};
}

export async function artistGenres(id: string): Promise<MbGenre[]> {
	const a = await mb<{ genres?: MbGenre[] }>(`/artist/${id}`, { inc: 'genres' });
	return a.genres ?? [];
}

export async function lookupRecordings(ids: string[]): Promise<RawRecording[]> {
	const out: RawRecording[] = [];
	for (const id of ids.slice(0, 5)) {
		out.push(
			await mb<RawRecording>(`/recording/${id}`, {
				inc: 'artist-credits+releases+release-groups+media+isrcs'
			})
		);
	}
	return out;
}

/**
 * Front cover URL on the Cover Art Archive. The release group's cover is the canonical album
 * art; a specific release's scan (a regional pressing, a promo) is the fallback — or the other
 * way round when `prefer` is 'release'.
 */
export async function findCoverArt(
	releaseId: string,
	releaseGroupId?: string | null,
	prefer: 'release' | 'release-group' = 'release'
): Promise<string | null> {
	const release = `https://coverartarchive.org/release/${releaseId}/front-1200`;
	const group = releaseGroupId
		? `https://coverartarchive.org/release-group/${releaseGroupId}/front-1200`
		: null;
	const order = prefer === 'release-group' ? [group, release] : [release, group];
	for (const url of order) {
		if (!url) continue;
		const res = await fetch(url, {
			method: 'HEAD',
			redirect: 'follow',
			signal: AbortSignal.timeout(15_000)
		}).catch(() => null);
		if (res?.ok) return url; // keep the stable CAA link, not the mirror it redirects to
	}
	return null;
}
