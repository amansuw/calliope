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

async function mb<T>(path: string, params: Record<string, string>): Promise<T> {
	return throttled(async () => {
		const url = `${MB}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`;
		const res = await fetch(url, {
			headers: { 'User-Agent': UA, Accept: 'application/json' },
			signal: AbortSignal.timeout(20_000)
		});
		if (res.status === 503) throw new Error('MusicBrainz is rate limiting — try again in a moment');
		if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
		return (await res.json()) as T;
	});
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

export async function searchRecordings(q: {
	artist?: string | null;
	title: string;
	album?: string | null;
	durationMs?: number | null;
}): Promise<MbCandidate[]> {
	const parts = [`recording:"${esc(q.title)}"`];
	if (q.artist) parts.push(`artist:"${esc(q.artist)}"`);
	if (q.album) parts.push(`release:"${esc(q.album)}"`);
	if (q.durationMs) {
		const s = Math.round(q.durationMs);
		parts.push(`dur:[${s - 5000} TO ${s + 5000}]`);
	}
	let data = await mb<{ recordings: RawRecording[] }>('/recording', {
		query: parts.join(' AND '),
		limit: '15'
	});
	// Album/duration constraints can be too strict for mis-tagged files: relax once.
	if (!data.recordings.length && (q.album || q.durationMs)) {
		data = await mb<{ recordings: RawRecording[] }>('/recording', {
			query: parts.slice(0, 2).join(' AND '),
			limit: '15'
		});
	}
	const out = data.recordings.map((r) => toCandidate(r, 'search'));
	// MB scores tie a lot (many 100s); break ties by closeness to the file's duration.
	const diff = (c: MbCandidate) =>
		q.durationMs && c.durationMs ? Math.abs(c.durationMs - q.durationMs) : 60_000;
	return out.sort((a, b) => b.score - a.score || diff(a) - diff(b));
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

/** Front cover URL on the Cover Art Archive, trying the release then its release group. */
export async function findCoverArt(
	releaseId: string,
	releaseGroupId?: string | null
): Promise<string | null> {
	for (const url of [
		`https://coverartarchive.org/release/${releaseId}/front-1200`,
		releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-1200` : null
	]) {
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
