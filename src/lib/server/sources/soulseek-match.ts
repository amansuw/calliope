import { fileParts, guessTags, type SlskHit, type SlskRef } from '$lib/soulseek';
import { cleanTitle, normalize, similarity, tokens } from '$lib/text';
import { durationScore, VARIANTS, type MatchTarget } from './score';

export interface SlskPick {
	ref: SlskRef;
	user: string;
	name: string;
	score: number;
	freeSlot: boolean;
}

const LOSSLESS = new Set(['flac']);
const MIN_BYTES = 2 * 1024 * 1024;

/** Words every shared path must contain: Soulseek only returns files matching all of them. */
export function soulseekQuery(target: MatchTarget) {
	const artist = target.artists?.[0] ?? target.artist;
	return normalize(`${artist} ${cleanTitle(target.title)}`)
		.split(' ')
		.filter((w) => w.length > 1)
		.join(' ');
}

/**
 * Lossless files that are plausibly the wanted recording, best first. Scored like YouTube
 * candidates (title, artist, duration, version markers), then ordered so a peer that can send
 * right away and an ordinary CD-quality file win between equally good matches.
 */
export function rankLossless(
	hits: SlskHit[],
	target: MatchTarget,
	opts: { minScore?: number; freeOnly?: boolean; maxBytes?: number } = {}
): SlskPick[] {
	const minScore = opts.minScore ?? 0.7;
	const targetNorm = ` ${normalize(target.title)} `;
	const artistNames = target.artists?.length ? target.artists : [target.artist];
	const scored: (SlskPick & { hiRes: boolean; speed: number; queue: number })[] = [];
	const seen = new Set<string>();

	for (const h of hits) {
		const { name, ext } = fileParts(h.file);
		if (!LOSSLESS.has(ext)) continue;
		if (opts.freeOnly && !h.slots) continue;
		if (h.size < MIN_BYTES || (opts.maxBytes && h.size > opts.maxBytes)) continue;
		const id = `${h.user}\u0000${h.file}`;
		if (seen.has(id)) continue;
		seen.add(id);

		const guess = guessTags(h.file);
		const titleSim = Math.max(
			similarity(target.title, guess.title),
			similarity(cleanTitle(target.title), guess.title)
		);
		if (titleSim < 0.6) continue;

		const pathTokens = tokens(h.file.replace(/[\\/_.]+/g, ' '));
		const artistSim = Math.max(
			0,
			...artistNames.map((a) => {
				const t = [...tokens(a)];
				return t.length ? t.filter((x) => pathTokens.has(x)).length / t.length : 0;
			})
		);
		if (artistSim < 0.5) continue;

		const durationSec = h.attribs[1] ?? null;
		const dur = durationScore(target.durationMs, durationSec);
		// A known length that is far off is another recording, whatever the name says
		if (dur !== null && Math.abs(target.durationMs! / 1000 - durationSec!) > 12) continue;

		let score =
			dur === null
				? 0.55 * titleSim + 0.45 * artistSim
				: 0.35 * titleSim + 0.25 * artistSim + 0.4 * dur;
		const pathNorm = ` ${normalize(h.file.replace(/[\\/_.]+/g, ' '))} `;
		for (const v of VARIANTS) {
			if (pathNorm.includes(` ${v} `) && !targetNorm.includes(` ${v} `)) score -= 0.4;
		}
		// Without a length to check against, the name alone is weaker evidence
		if (dur === null) score -= 0.1;
		if (score < minScore) continue;

		scored.push({
			ref: { user: h.user, file: h.file, size: h.size },
			user: h.user,
			name,
			score: Math.min(1, score),
			freeSlot: h.slots,
			hiRes: (h.attribs[5] ?? 16) > 16 || (h.attribs[4] ?? 44100) > 48000,
			speed: h.speed ?? 0,
			queue: h.queueLength ?? 0
		});
	}

	const bucket = (s: number) => Math.round(s * 20);
	return scored
		.sort(
			(a, b) =>
				bucket(b.score) - bucket(a.score) ||
				Number(b.freeSlot) - Number(a.freeSlot) ||
				Number(a.hiRes) - Number(b.hiRes) ||
				a.queue - b.queue ||
				b.speed - a.speed
		)
		.map(({ ref, user, name, score, freeSlot }) => ({ ref, user, name, score, freeSlot }));
}
