import { describe, expect, it } from 'vitest';
import type { LibraryRow } from './library-columns';
import { filterRows, sortRows, type LibraryFilter } from './library-filter';

const row = (o: Partial<LibraryRow>): LibraryRow => ({
	id: Math.random().toString(36),
	title: null,
	artist: null,
	album: null,
	albumArtist: null,
	year: null,
	genre: null,
	trackNumber: null,
	discNumber: null,
	durationMs: null,
	format: 'mp3',
	codec: null,
	bitrate: 320,
	sampleRate: 44100,
	bitsPerSample: null,
	lossless: false,
	size: 1,
	hasArtwork: true,
	hasLyrics: true,
	relPath: '',
	addedAt: 0,
	mtimeMs: 0,
	...o
});

const base: LibraryFilter = {
	q: '',
	formats: [],
	quality: 'all',
	issues: [],
	artist: null,
	album: null
};

describe('library filtering', () => {
	const rows = [
		row({ title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', trackNumber: 1 }),
		row({
			title: 'Aerodynamic',
			artist: 'Daft Punk',
			album: 'Discovery',
			trackNumber: 2,
			hasArtwork: false
		}),
		row({ title: 'Uprising', artist: 'Muse', format: 'flac', lossless: true, bitrate: 900 }),
		row({ title: 'Low', artist: 'X', bitrate: 128 })
	];

	it('matches every search term across fields', () => {
		expect(filterRows(rows, { ...base, q: 'daft disc' }).map((r) => r.title)).toEqual([
			'One More Time',
			'Aerodynamic'
		]);
	});

	it('filters by quality and issues', () => {
		expect(filterRows(rows, { ...base, quality: 'lossless' }).map((r) => r.title)).toEqual([
			'Uprising'
		]);
		expect(filterRows(rows, { ...base, quality: 'low' }).map((r) => r.title)).toEqual(['Low']);
		expect(filterRows(rows, { ...base, issues: ['noArt'] }).map((r) => r.title)).toEqual([
			'Aerodynamic'
		]);
	});

	it('sorts with secondary keys and keeps empties last', () => {
		const sorted = sortRows(rows, [
			{ key: 'album', dir: -1 },
			{ key: 'title', dir: 1 }
		]);
		expect(sorted.map((r) => r.title)).toEqual(['One More Time', 'Aerodynamic', 'Low', 'Uprising']);
	});
});
