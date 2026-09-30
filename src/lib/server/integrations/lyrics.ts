const BASE = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'Calliope (https://github.com/) lrclib client' };

export interface Lyrics {
	plain: string | null;
	synced: string | null;
}

interface LrcRecord {
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
	duration?: number;
	instrumental?: boolean;
}

/** LRCLIB lookup: exact signature first, then fuzzy search ranked by duration. */
export async function fetchLyrics(q: {
	artist: string;
	title: string;
	album?: string | null;
	durationSec?: number | null;
}): Promise<Lyrics | null> {
	try {
		if (q.durationSec) {
			const params = new URLSearchParams({
				artist_name: q.artist,
				track_name: q.title,
				duration: String(Math.round(q.durationSec))
			});
			if (q.album) params.set('album_name', q.album);
			const res = await fetch(`${BASE}/get?${params}`, {
				headers: HEADERS,
				signal: AbortSignal.timeout(15_000)
			});
			if (res.ok) return shape((await res.json()) as LrcRecord);
		}
		const params = new URLSearchParams({ artist_name: q.artist, track_name: q.title });
		const res = await fetch(`${BASE}/search?${params}`, {
			headers: HEADERS,
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return null;
		const list = ((await res.json()) as LrcRecord[]).filter((r) => r.plainLyrics || r.syncedLyrics);
		if (!list.length) return null;
		if (q.durationSec) {
			list.sort(
				(a, b) =>
					Math.abs((a.duration ?? 0) - q.durationSec!) -
					Math.abs((b.duration ?? 0) - q.durationSec!)
			);
			if (Math.abs((list[0].duration ?? 0) - q.durationSec) > 10) return null;
		}
		return shape(list[0]);
	} catch {
		return null;
	}
}

function shape(r: LrcRecord): Lyrics | null {
	if (r.instrumental) return null;
	const out = { plain: r.plainLyrics || null, synced: r.syncedLyrics || null };
	return out.plain || out.synced ? out : null;
}
