import { cleanTitle, normalize, similarity, tokens } from '$lib/text';

export interface MatchTarget {
	title: string;
	artist: string;
	artists?: string[];
	durationMs?: number | null;
}

export interface MatchCandidate {
	id: string;
	title: string;
	channel: string | null;
	durationSec: number | null;
	/** Came from YouTube Music's own top "Songs" result */
	ytmTop?: boolean;
	/** Structured metadata from YouTube Music, when fetched */
	track?: string | null;
	artist?: string | null;
}

/** Version markers that make a different recording unless the target title has them too. */
export const VARIANTS = [
	'live',
	'cover',
	'remix',
	'karaoke',
	'instrumental',
	'sped up',
	'slowed',
	'reverb',
	'nightcore',
	'8d',
	'acoustic',
	'extended',
	'1 hour',
	'hour loop',
	'tutorial',
	'reaction',
	'mashup',
	'bass boosted',
	'piano version',
	'demo'
];

export function durationScore(
	targetMs: number | null | undefined,
	candSec: number | null | undefined
): number | null {
	if (!targetMs || !candSec) return null;
	const diff = Math.abs(targetMs / 1000 - candSec);
	if (diff <= 2) return 1;
	if (diff >= 30) return 0;
	return 1 - (diff - 2) / 28;
}

export function scoreCandidate(target: MatchTarget, c: MatchCandidate): number {
	const candTitle = c.track ?? cleanTitle(c.title);
	const candText = `${c.artist ?? ''} ${c.channel ?? ''} ${c.title}`;

	const titleSim = Math.max(
		similarity(target.title, candTitle),
		similarity(`${target.artist} ${target.title}`, cleanTitle(c.title))
	);

	const candTokens = tokens(candText);
	const artistNames = target.artists?.length ? target.artists : [target.artist];
	const artistHits = artistNames.map((a) => {
		const t = [...tokens(a)];
		return t.length ? t.filter((x) => candTokens.has(x)).length / t.length : 0;
	});
	const artistSim = Math.max(0, ...artistHits);

	const dur = durationScore(target.durationMs, c.durationSec);

	let score =
		dur === null
			? 0.55 * titleSim + 0.45 * artistSim
			: 0.35 * titleSim + 0.25 * artistSim + 0.4 * dur;

	const targetNorm = ` ${normalize(target.title)} `;
	const candNorm = ` ${normalize(c.title)} `;
	for (const v of VARIANTS) {
		if (candNorm.includes(` ${v} `) && !targetNorm.includes(` ${v} `)) score -= 0.4;
	}
	if (c.channel?.endsWith(' - Topic')) score += 0.08;
	if (c.ytmTop) score += 0.08;
	if (/official audio/i.test(c.title)) score += 0.04;

	return Math.max(0, Math.min(1, score));
}
