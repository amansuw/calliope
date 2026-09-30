import { describe, expect, it } from 'vitest';
import { cleanTitle, matchKey, similarity, splitArtistTitle } from './text';

describe('text helpers', () => {
	it('cleans upload noise', () => {
		expect(cleanTitle('Daft Punk - Around The World (Official Music Video Remastered)')).toBe(
			'Daft Punk - Around The World (Official Music Video Remastered)'
		);
		expect(cleanTitle('Song Name (Official Video) [HD]')).toBe('Song Name');
		expect(cleanTitle('Song Name (Lyrics) | Some Channel')).toBe('Song Name');
	});

	it('splits artist/title', () => {
		expect(splitArtistTitle('Around the World', 'Daft Punk - Topic')).toEqual({
			artist: 'Daft Punk',
			title: 'Around the World'
		});
		expect(splitArtistTitle('Muse - Uprising (Official Video)', 'MuseVEVO')).toEqual({
			artist: 'Muse',
			title: 'Uprising'
		});
		expect(splitArtistTitle('Uprising', 'MuseVEVO')).toEqual({ artist: 'Muse', title: 'Uprising' });
	});

	it('scores similarity', () => {
		expect(similarity('Around the World', 'around the world')).toBe(1);
		expect(similarity('Beyoncé', 'Beyonce')).toBe(1);
		expect(similarity('One More Time', 'Something Else')).toBe(0);
	});

	it('builds match keys ignoring feat and remaster noise', () => {
		expect(matchKey('Daft Punk, Romanthony', 'One More Time - 2021 Remaster')).toBe(
			matchKey('Daft Punk', 'One More Time')
		);
		expect(matchKey('A feat. B', 'Song (feat. B)')).toBe('a|song');
		// "ft" inside a word is not a featuring credit
		expect(matchKey('Daft Punk', 'Aerodynamic')).toBe('daft punk|aerodynamic');
		expect(matchKey('Daft Punk ft. Pharrell', 'Get Lucky')).toBe('daft punk|get lucky');
	});
});
