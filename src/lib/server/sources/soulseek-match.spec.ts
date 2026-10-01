import { describe, expect, it } from 'vitest';
import type { SlskHit } from '$lib/soulseek';
import { rankLossless, soulseekQuery } from './soulseek-match';

const MB = 1024 * 1024;
const hit = (user: string, file: string, extra: Partial<SlskHit> = {}): SlskHit => ({
	user,
	file,
	size: 35 * MB,
	slots: true,
	speed: 100,
	attribs: { 1: 334, 4: 44100, 5: 16 },
	...extra
});
const target = {
	title: 'Wish You Were Here',
	artist: 'Pink Floyd',
	artists: ['Pink Floyd'],
	durationMs: 334_000
};

describe('soulseekQuery', () => {
	it('uses the first artist and a title without decorations or credits', () => {
		expect(
			soulseekQuery({
				title: 'Cracker Island (feat. Thundercat) [Official Video]',
				artist: 'Gorillaz, Thundercat',
				artists: ['Gorillaz', 'Thundercat']
			})
		).toBe('gorillaz cracker island');
	});
});

describe('rankLossless', () => {
	const album = 'music\\Pink Floyd\\Wish You Were Here (1975)\\';

	it('keeps only lossless files of the right song, artist and length', () => {
		const picks = rankLossless(
			[
				hit('a', `${album}04 - Wish You Were Here.flac`),
				hit('mp3', `${album}04 - Wish You Were Here.mp3`),
				hit('other-song', `${album}01 - Shine On You Crazy Diamond.flac`),
				hit('cover', 'music\\Sparklehorse\\04 - Wish You Were Here.flac'),
				hit('live', 'music\\Pink Floyd\\Pulse (Live)\\11 - Wish You Were Here.flac'),
				hit('wrong-length', `${album}04 - Wish You Were Here.flac`, { attribs: { 1: 420 } }),
				hit('tiny', `${album}04 - Wish You Were Here.flac`, { size: 1 * MB })
			],
			target
		);
		expect(picks.map((p) => p.user)).toEqual(['a']);
		expect(picks[0].score).toBeGreaterThan(0.9);
	});

	it('prefers a free slot and CD quality between equally good matches', () => {
		const file = `${album}04 - Wish You Were Here.flac`;
		const picks = rankLossless(
			[
				hit('queued', file, { slots: false, queueLength: 20 }),
				hit('hires', file, { attribs: { 1: 334, 4: 96000, 5: 24 } }),
				hit('cd', file)
			],
			target
		);
		expect(picks.map((p) => p.user)).toEqual(['cd', 'hires', 'queued']);
		expect(
			rankLossless([hit('queued', file, { slots: false })], target, { freeOnly: true })
		).toEqual([]);
	});

	it('still matches when the peer reports no length, with a lower score', () => {
		const [pick] = rankLossless(
			[hit('a', `${album}04 - Wish You Were Here.flac`, { attribs: {} })],
			target
		);
		expect(pick.score).toBeCloseTo(0.9, 5);
	});
});
