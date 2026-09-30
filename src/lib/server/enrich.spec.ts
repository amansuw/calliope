import { describe, expect, it } from 'vitest';
import type { MbCandidate, MbRelease } from './studio/musicbrainz';
import {
	acousticPlausible,
	asciiPunctuation,
	matchConfidence,
	pickAcoustic,
	pickCandidate,
	pickGenres,
	pickRelease,
	releaseKind
} from './enrich';

const rel = (o: Partial<MbRelease>): MbRelease => ({
	id: Math.random().toString(36),
	title: 'X',
	date: null,
	year: null,
	country: null,
	status: 'Official',
	primaryType: 'Album',
	secondaryTypes: [],
	releaseGroupId: 'rg',
	albumArtist: 'System of a Down',
	trackNumber: 1,
	trackCount: 14,
	discNumber: 1,
	...o
});

const cand = (o: Partial<MbCandidate>): MbCandidate => ({
	recordingId: Math.random().toString(36),
	title: 'Toxicity',
	artist: 'System of a Down',
	artists: ['System of a Down'],
	artistId: 'a1',
	durationMs: 219_000,
	isrcs: [],
	score: 1,
	releases: [],
	source: 'search',
	...o
});

describe('enrichment selection', () => {
	const q = { artist: 'System Of A Down', title: 'Toxicity', durationMs: 220_000 };

	it('prefers the studio-album recording over live cuts and singles', () => {
		const live = cand({
			durationMs: 281_000,
			releases: [rel({ title: 'Live', secondaryTypes: ['Live'] })]
		});
		const single = cand({
			durationMs: 219_500,
			releases: [rel({ title: 'Toxicity', primaryType: 'Single' })]
		});
		const album = cand({
			durationMs: 218_939,
			releases: [rel({ title: 'Toxicity', trackNumber: 12 })]
		});
		expect(pickCandidate(q, [live, single, album])).toBe(album);
	});

	it('treats untyped live albums as live and tolerates video-length differences', () => {
		const aq = { artist: 'System Of A Down', title: 'Aerials', durationMs: 224_000 };
		const liveAlbum = cand({
			title: 'Aerials',
			durationMs: 226_000,
			releases: [rel({ title: 'Live at the Wireless' })]
		});
		const studio = cand({
			title: 'Aerials',
			durationMs: 235_059,
			releases: [rel({ title: 'Toxicity', trackNumber: 14 })]
		});
		expect(pickCandidate(aq, [liveAlbum, studio])).toBe(studio);
	});

	it('rejects instrumental/remix recordings the file did not ask for', () => {
		const rq = { artist: 'Rick Astley', title: 'Never Gonna Give You Up', durationMs: 213_000 };
		const inst = cand({
			artist: 'Rick Astley',
			title: 'Never Gonna Give You Up (instrumental)',
			durationMs: 213_000
		});
		const orig = cand({
			artist: 'Rick Astley',
			title: 'Never Gonna Give You Up',
			durationMs: 213_500
		});
		expect(pickCandidate(rq, [inst, orig])).toBe(orig);
		expect(
			pickCandidate({ ...rq, title: 'Never Gonna Give You Up (Instrumental)' }, [inst, orig])
		).toBe(inst);
	});

	it('rejects different songs and artists', () => {
		expect(pickCandidate(q, [cand({ title: 'Aerials' })])).toBeNull();
		expect(pickCandidate(q, [cand({ artist: 'Toxicity Tribute Band' })])).toBeNull();
	});

	it('matches unicode-hyphen titles', () => {
		const c = cand({ title: 'I‐E‐A‐I‐A‐I‐O', durationMs: 188_600 });
		expect(
			pickCandidate({ artist: 'System Of A Down', title: 'I-E-A-I-A-I-O', durationMs: 190_000 }, [
				c
			])
		).toBe(c);
	});

	it('picks the earliest studio album, or the album the file already names', () => {
		const c = cand({
			releases: [
				rel({ title: 'Chop Suey!', primaryType: 'Single', date: '2001-08-13' }),
				rel({ title: 'Toxicity', date: '2002-04-23' }),
				rel({ title: 'Toxicity', date: '2001-09-04', trackNumber: 6 }),
				rel({ title: 'Greatest Hits', secondaryTypes: ['Compilation'], date: '2010' })
			]
		});
		expect(pickRelease(c)).toMatchObject({ title: 'Toxicity', date: '2001-09-04', trackNumber: 6 });
		expect(pickRelease(c, 'greatest hits')).toMatchObject({ title: 'Greatest Hits' });
	});

	it('keeps strong, specific genres', () => {
		expect(
			pickGenres([
				{ name: 'alternative metal', count: 20 },
				{ name: 'metal', count: 10 },
				{ name: 'nu metal', count: 7 },
				{ name: 'rock', count: 3 }
			])
		).toEqual(['Alternative Metal', 'Nu Metal']);
		expect(
			pickGenres([
				{ name: 'dance-pop', count: 5 },
				{ name: 'pop', count: 5 },
				{ name: 'soft rock', count: 2 }
			])
		).toEqual(['Dance-Pop', 'Soft Rock']);
	});

	it('converts typographic punctuation', () => {
		expect(asciiPunctuation('I‐E‐A‐I‐A‐I‐O · Don’t “Stop”')).toBe('I-E-A-I-A-I-O · Don\'t "Stop"');
	});

	it('classifies releases', () => {
		expect(releaseKind(rel({}))).toBe('album');
		expect(releaseKind(rel({ title: 'Pledge of Allegiance Tour: Live' }))).toBe('live');
		expect(releaseKind(rel({ status: 'Bootleg' }))).toBe('bootleg');
		expect(releaseKind(rel({ secondaryTypes: ['Compilation'] }))).toBe('compilation');
		expect(releaseKind(rel({ primaryType: 'Single' }))).toBe('single');
	});

	it('ranks confidence by release type and duration, unlike MB text scores', () => {
		const c = cand({ durationMs: 219_000 });
		const album = matchConfidence(q, c, rel({ title: 'Toxicity' }), false);
		const single = matchConfidence(q, c, rel({ primaryType: 'Single' }), false);
		const live = matchConfidence(q, c, rel({ secondaryTypes: ['Live'] }), false);
		const bootleg = matchConfidence(q, c, rel({ status: 'Bootleg' }), false);
		expect(album).toBeGreaterThan(single);
		expect(single).toBeGreaterThan(live);
		expect(live).toBeGreaterThan(bootleg);
		expect(album).toBeGreaterThanOrEqual(0.9);
		// a far-off duration drags confidence down
		expect(matchConfidence(q, cand({ durationMs: 281_000 }), rel({}), false)).toBeLessThan(
			album - 0.15
		);
	});

	it('trusts fingerprint matches regardless of the file title', () => {
		const verified = matchConfidence(
			{ ...q, title: 'track01' },
			cand({ score: 0.97 }),
			rel({}),
			true
		);
		expect(verified).toBeGreaterThan(0.95);
		const pick = pickAcoustic(q, [
			cand({ score: 0.97, releases: [rel({ secondaryTypes: ['Compilation'] })] }),
			cand({ score: 0.95, releases: [rel({ title: 'Toxicity' })] }),
			cand({ score: 0.6, releases: [rel({})] })
		]);
		expect(pick?.releases[0].title).toBe('Toxicity');
	});

	it('ignores implausible fingerprint hits (AcoustID data errors)', () => {
		const wrong = cand({
			title: 'Money Spread',
			artist: 'Lil Uzi Vert feat. Young Nudy',
			score: 0.98,
			releases: [rel({ title: 'Eternal Atake' })]
		});
		const right = cand({ score: 0.98, releases: [rel({ title: 'Toxicity' })] });
		expect(acousticPlausible(q, wrong)).toBe(false);
		expect(pickAcoustic(q, [wrong, right])).toBe(right);
		expect(pickAcoustic(q, [wrong])).toBeNull();
		// untagged files trust the fingerprint
		expect(acousticPlausible({ artist: 'Unknown Artist', title: 'track01' }, wrong)).toBe(true);
		// a wrong title with the right artist is still the same song family
		expect(acousticPlausible({ artist: 'System of a Down', title: 'Track 12' }, right)).toBe(true);
	});
});
