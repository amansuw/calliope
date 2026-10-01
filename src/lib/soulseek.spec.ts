import { describe, expect, it } from 'vitest';
import { decodeRef, encodeRef, guessTags, shapeResults, type SlskHit } from './soulseek';

const hit = (user: string, file: string, extra: Partial<SlskHit> = {}): SlskHit => ({
	user,
	file,
	size: 1000,
	slots: true,
	speed: 100,
	attribs: {},
	...extra
});

describe('shapeResults', () => {
	const hits = [
		hit('slow', '@@a\\Music\\Gorillaz\\Cracker Island\\02 - Cracker Island.flac', {
			slots: false,
			queueLength: 40
		}),
		hit('fast', 'music\\Gorillaz\\Cracker Island (2023)\\10 - Skinny Ape.flac', {
			attribs: { 1: 271, 4: 44100, 5: 16 }
		}),
		hit('fast', 'music\\Gorillaz\\Cracker Island (2023)\\2 - Oil.flac'),
		hit('fast', 'music\\Gorillaz\\Cracker Island (2023)\\2 - Oil.flac'),
		hit('fast', 'music\\Gorillaz\\Cracker Island (2023)\\cover.jpg'),
		hit('mp3s', 'x\\Gorillaz - Cracker Island.mp3', { attribs: { 0: 320 } })
	];

	it('groups by user and folder, drops non-audio and duplicates, sorts tracks naturally', () => {
		const groups = shapeResults(hits);
		const fast = groups.find((g) => g.user === 'fast')!;
		expect(fast.label).toBe('Gorillaz / Cracker Island (2023)');
		expect(fast.files.map((f) => f.name)).toEqual(['2 - Oil.flac', '10 - Skinny Ape.flac']);
		expect(fast.files[1]).toMatchObject({ durationSec: 271, sampleRate: 44100, bitDepth: 16 });
		expect(fast.totalSize).toBe(2000);
	});

	it('ranks free slots first, then lossless', () => {
		expect(shapeResults(hits).map((g) => g.user)).toEqual(['fast', 'mp3s', 'slow']);
	});

	it('filters by format', () => {
		expect(shapeResults(hits, { format: 'flac' }).map((g) => g.user)).toEqual(['fast', 'slow']);
	});
});

describe('guessTags', () => {
	it('reads track number, artist and album from the path', () => {
		expect(
			guessTags('music\\Gorillaz\\Cracker Island (2023) [FLAC]\\03 - Silent Running.flac')
		).toEqual({
			title: 'Silent Running',
			artist: 'Gorillaz',
			album: 'Cracker Island',
			trackNumber: 3
		});
	});

	it('prefers an artist in the file name and an "Artist - Album" folder', () => {
		expect(guessTags('x\\Daft Punk - Discovery\\04. Daft Punk - Harder Better.flac')).toEqual({
			title: 'Harder Better',
			artist: 'Daft Punk',
			album: 'Discovery',
			trackNumber: 4
		});
		expect(guessTags('x\\Daft Punk - Discovery\\1-04 Harder Better.flac')).toMatchObject({
			title: 'Harder Better',
			artist: 'Daft Punk',
			trackNumber: 4
		});
	});
});

describe('refs', () => {
	it('round-trips users and paths with awkward characters', () => {
		const ref = { user: 'some user/42', file: '@@x\\Björk #1\\01 - a/b?.flac', size: 12345 };
		expect(decodeRef(encodeRef(ref))).toEqual(ref);
		expect(decodeRef('https://www.youtube.com/watch?v=x')).toBeNull();
	});
});
