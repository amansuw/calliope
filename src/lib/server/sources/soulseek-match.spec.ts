import { describe, expect, it } from 'vitest';
import type { SlskHit } from '$lib/soulseek';
import { baseAlbum, describeReport, matchLossless, plainTitle, searchPlan } from './soulseek-match';

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
	durationMs: 334_000,
	album: 'Wish You Were Here',
	trackNumber: 4
};
const users = (hits: SlskHit[], t = target, opts = {}) =>
	matchLossless(hits, t, opts).picks.map((p) => p.user);

describe('cleanup', () => {
	it('strips guest credits and upload decorations from titles', () => {
		expect(plainTitle('Cracker Island ft. Thundercat')).toBe('Cracker Island');
		expect(plainTitle('Cracker Island (feat. Thundercat) [Official Video]')).toBe('Cracker Island');
		expect(plainTitle('Feather')).toBe('Feather');
	});

	it('strips edition suffixes from albums, but not a name in brackets', () => {
		expect(baseAlbum('Cracker Island (Deluxe)')).toBe('Cracker Island');
		expect(baseAlbum('Rumours (Super Deluxe) [2013 Remaster]')).toBe('Rumours');
		expect(baseAlbum("(What's the Story) Morning Glory?")).toBe(
			"(What's the Story) Morning Glory?"
		);
	});
});

describe('searchPlan', () => {
	it('goes from precise to wide and never repeats a search', () => {
		expect(
			searchPlan({
				title: 'Cracker Island (feat. Thundercat) [Official Video]',
				artist: 'Gorillaz, Thundercat',
				artists: ['Gorillaz', 'Thundercat'],
				album: 'Cracker Island'
			})
		).toEqual([
			{ label: 'artist + title', query: 'gorillaz cracker island' },
			{ label: 'title only', query: 'cracker island' }
		]);
		expect(
			searchPlan({ title: 'Silent Running', artist: 'Gorillaz', album: 'Cracker Island' }).map(
				(p) => p.query
			)
		).toEqual([
			'gorillaz silent running',
			'silent running',
			'gorillaz cracker island',
			'cracker island'
		]);
	});

	it('never searches for a short common title on its own', () => {
		expect(searchPlan({ title: 'Oil', artist: 'Gorillaz', album: 'Cracker Island' })).toEqual([
			{ label: 'artist + title', query: 'gorillaz oil' },
			{ label: 'title + album', query: 'oil cracker island' },
			{ label: 'artist + album', query: 'gorillaz cracker island' },
			{ label: 'album only', query: 'cracker island' }
		]);
		expect(
			searchPlan({ title: 'Go', artist: 'The Chemical Brothers' }).map((p) => p.label)
		).toEqual(['artist + title']);
	});
});

describe('matchLossless', () => {
	const album = 'music\\Pink Floyd\\Wish You Were Here (1975)\\';

	it('keeps only lossless files of the right song, artist and length', () => {
		const report = matchLossless(
			[
				hit('a', `${album}04 - Wish You Were Here.flac`),
				hit('mp3', `${album}04 - Wish You Were Here.mp3`),
				hit('other-song', `${album}01 - Shine On You Crazy Diamond.flac`),
				hit('cover', 'music\\Sparklehorse\\Good Morning Spider\\04 - Wish You Were Here.flac', {
					attribs: { 1: 250 }
				}),
				hit('live', 'music\\Pink Floyd\\Pulse (Live)\\11 - Wish You Were Here.flac'),
				hit('wrong-length', `${album}04 - Wish You Were Here.flac`, { attribs: { 1: 420 } }),
				hit('tiny', `${album}04 - Wish You Were Here.flac`, { size: 1 * MB })
			],
			target
		);
		expect(report.picks.map((p) => p.user)).toEqual(['a']);
		expect(report.picks[0].score).toBeGreaterThan(0.9);
		expect(report.picks[0].evidence).toEqual(['artist', 'album', 'track number', 'length']);
		expect(report.lossless).toBe(6);
		expect(report.rejected).toEqual({
			'another title': 1,
			'wrong length': 2,
			'another version (live, remix…)': 1,
			'unusual size': 1
		});
		expect(describeReport(report)).toMatch(/^6 lossless files — 2 wrong length/);
	});

	it('accepts a file with no artist in its path only when length and album or track agree', () => {
		const bare = 'Discography [1967-2014]\\1975 - Wish You Were Here\\04 -Wish You Were Here.flac';
		expect(users([hit('bare', bare)])).toEqual(['bare']);
		// same name, but nothing to check the length against
		expect(users([hit('no-length', bare, { attribs: {} })])).toEqual([]);
		// right length, but neither the album folder nor the track number fit
		expect(users([hit('stray', 'stuff\\mix\\Wish You Were Here.flac')])).toEqual([]);
		// another artist's song of the same name and similar length
		expect(
			users([hit('same-name', 'x\\Incubus\\Morning View\\03 - Wish You Were Here.flac')])
		).toEqual([]);
	});

	it('reads "Artist - Album - 01 - Title" file names', () => {
		const file = 'x\\Gorillaz - Cracker Island - 04 - Silent Running.flac';
		const report = matchLossless([hit('u', file, { attribs: { 1: 266 } })], {
			title: 'Silent Running',
			artist: 'Gorillaz',
			durationMs: 266_000,
			album: 'Cracker Island',
			trackNumber: 4
		});
		expect(report.picks[0]?.evidence).toContain('track number');
	});

	it('prefers a free slot and CD quality between equally good matches', () => {
		const file = `${album}04 - Wish You Were Here.flac`;
		const hits = [
			hit('queued', file, { slots: false, queueLength: 20 }),
			hit('hires', file, { attribs: { 1: 334, 4: 96000, 5: 24 } }),
			hit('cd', file)
		];
		expect(users(hits)).toEqual(['cd', 'hires', 'queued']);
		const free = matchLossless(hits, target, { freeOnly: true });
		expect(free.picks.map((p) => p.user)).toEqual(['cd', 'hires']);
		expect(free.busy).toBe(1);
	});

	it('takes the hi-res copy first when asked to, even if the peer reports no format', () => {
		const file = `${album}04 - Wish You Were Here.flac`;
		const hits = [
			hit('cd', file),
			hit('hires', file, { attribs: { 1: 334, 4: 48000, 5: 24 } }),
			hit('big', file, { size: 120 * MB, attribs: { 1: 334 } }),
			hit('other-song', `${album}01 - Shine On You Crazy Diamond.flac`, {
				attribs: { 1: 334, 4: 96000, 5: 24 }
			})
		];
		expect(users(hits, target, { preferHiRes: true })).toEqual(['hires', 'big', 'cd']);
		expect(users(hits)[0]).toBe('cd');
	});

	it('puts the folder that already delivered this album first, and skips tried files', () => {
		const other = 'share\\Pink Floyd\\WYWH\\04 - Wish You Were Here.flac';
		const hits = [
			hit('fast', `${album}04 - Wish You Were Here.flac`, { speed: 999 }),
			hit('known', other)
		];
		expect(
			users(hits, target, { prefer: { user: 'known', dir: 'share\\Pink Floyd\\WYWH' } })
		).toEqual(['known', 'fast']);
		expect(users(hits, target, { exclude: new Set([`known\u0000${other}`]) })).toEqual(['fast']);
	});

	it('still matches when the peer reports no length, with a lower score', () => {
		const [pick] = matchLossless(
			[hit('a', `${album}04 - Wish You Were Here.flac`, { attribs: {} })],
			target
		).picks;
		expect(pick.score).toBeCloseTo(0.9, 5);
	});
});
