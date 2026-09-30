import { describe, expect, it } from 'vitest';
import { scoreCandidate } from './score';

const target = { title: 'Around the World', artist: 'Daft Punk', durationMs: 429_000 };

describe('scoreCandidate', () => {
	it('prefers the topic upload with matching duration', () => {
		const topic = scoreCandidate(target, {
			id: 'a',
			title: 'Around the World',
			channel: 'Daft Punk - Topic',
			durationSec: 429
		});
		const video = scoreCandidate(target, {
			id: 'b',
			title: 'Daft Punk - Around The World (Official Music Video Remastered)',
			channel: 'Daft Punk',
			durationSec: 242
		});
		expect(topic).toBeGreaterThan(0.9);
		expect(topic).toBeGreaterThan(video);
	});

	it('penalizes covers and live versions', () => {
		const cover = scoreCandidate(target, {
			id: 'c',
			title: 'Around The World (Daft Punk Cover)',
			channel: 'Someone',
			durationSec: 430
		});
		const live = scoreCandidate(target, {
			id: 'd',
			title: 'Daft Punk - Around the World (Live 2007)',
			channel: 'Fan',
			durationSec: 431
		});
		expect(cover).toBeLessThan(0.6);
		expect(live).toBeLessThan(0.6);
	});

	it('does not penalize a variant the target asked for', () => {
		const t = { title: 'Around the World (Live)', artist: 'Daft Punk', durationMs: 300_000 };
		expect(
			scoreCandidate(t, {
				id: 'e',
				title: 'Daft Punk - Around the World (Live)',
				channel: 'Daft Punk',
				durationSec: 300
			})
		).toBeGreaterThan(0.8);
	});

	it('rejects unrelated songs', () => {
		expect(
			scoreCandidate(target, {
				id: 'f',
				title: 'Muse - Uprising',
				channel: 'Muse',
				durationSec: 305
			})
		).toBeLessThan(0.3);
	});
});
