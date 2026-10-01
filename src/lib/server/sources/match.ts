import { getSettings } from '../settings';
import { scoreCandidate, type MatchCandidate, type MatchTarget } from './score';
import { ytMusicSearch, ytSearch, ytVideoInfo, type YtVideoInfo } from './youtube';

export interface MatchResult {
	candidate: MatchCandidate;
	score: number;
	/** Present when the winner was looked up in detail (YouTube Music metadata) */
	info: YtVideoInfo | null;
	considered: { id: string; title: string; score: number }[];
}

/** Find the best YouTube upload for a track known only by metadata (e.g. from Spotify). */
export async function findMatch(
	target: MatchTarget,
	opts: { signal?: AbortSignal; log?: (line: string) => void } = {}
): Promise<MatchResult | null> {
	const log = opts.log ?? (() => {});
	const query = `${target.artist} - ${target.title}`;
	const candidates = new Map<string, MatchCandidate>();
	const infos = new Map<string, YtVideoInfo>();

	// YouTube Music and plain YouTube searches are independent — run them side by side.
	const ytmTask =
		getSettings().pipeline.preferredSource !== 'youtube'
			? (async () => {
					const ytm = await ytMusicSearch(query, 3, { signal: opts.signal });
					log(`YouTube Music: ${ytm.length} song results`);
					// Flat YTM results lack duration/artist; look up the top one in full.
					return ytm[0] ? await ytVideoInfo(ytm[0].id, { signal: opts.signal }) : null;
				})().catch((err) => {
					if (opts.signal?.aborted) throw err;
					log(`YouTube Music search failed: ${(err as Error).message}`);
					return null;
				})
			: Promise.resolve(null);
	const [top, results] = await Promise.all([
		ytmTask,
		ytSearch(`${query} audio`, 6, { signal: opts.signal })
	]);
	log(`YouTube: ${results.length} results`);

	if (top) {
		infos.set(top.id, top);
		candidates.set(top.id, {
			id: top.id,
			title: top.title,
			channel: top.channel,
			durationSec: top.durationSec,
			track: top.track,
			artist: top.artist,
			ytmTop: true
		});
	}
	for (const r of results) {
		if (!candidates.has(r.id))
			candidates.set(r.id, {
				id: r.id,
				title: r.title,
				channel: r.channel,
				durationSec: r.durationSec
			});
	}

	const scored = [...candidates.values()]
		.map((c) => ({ c, score: scoreCandidate(target, c) }))
		.sort((a, b) => b.score - a.score);
	if (!scored.length) return null;

	for (const s of scored.slice(0, 4))
		log(
			`  ${s.score.toFixed(2)}  ${s.c.title} · ${s.c.channel ?? '?'} · ${s.c.durationSec ?? '?'}s`
		);

	const best = scored[0];
	return {
		candidate: best.c,
		score: best.score,
		info: infos.get(best.c.id) ?? null,
		considered: scored.slice(0, 6).map((s) => ({ id: s.c.id, title: s.c.title, score: s.score }))
	};
}
