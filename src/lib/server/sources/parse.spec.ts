import { describe, expect, it } from 'vitest';
import { parseLink, parseLinks } from './parse';

describe('parseLink', () => {
	it.each([
		[
			'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc',
			'spotify',
			'track',
			'4uLU6hMCjMI75M1A2tKUQC'
		],
		[
			'https://open.spotify.com/intl-de/album/2noRn2Aes5aoNVsU6iWThc',
			'spotify',
			'album',
			'2noRn2Aes5aoNVsU6iWThc'
		],
		['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'spotify', 'playlist', '37i9dQZF1DXcBWIGoYBM5M'],
		['https://youtu.be/K0HSD_i2DvA?t=3', 'youtube', 'track', 'K0HSD_i2DvA'],
		[
			'https://music.youtube.com/watch?v=Jb6gcoR266U&list=RDAMVM',
			'youtube',
			'track',
			'Jb6gcoR266U'
		],
		[
			'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
			'youtube',
			'playlist',
			'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'
		],
		[
			'https://music.youtube.com/playlist?list=OLAK5uy_abcdef',
			'youtube',
			'album',
			'OLAK5uy_abcdef'
		],
		['https://www.youtube.com/@DaftPunk/videos', 'youtube', 'channel', '@DaftPunk'],
		[
			'youtube.com/channel/UC_kRDKYrUlrbtrSiyu5Tflg',
			'youtube',
			'channel',
			'UC_kRDKYrUlrbtrSiyu5Tflg'
		]
	])('%s', (input, provider, kind, id) => {
		expect(parseLink(input)).toMatchObject({ provider, kind, id });
	});

	it('rejects unknown hosts', () => {
		expect(parseLink('https://soundcloud.com/foo')).toBeNull();
		expect(parseLink('not a url')).toBeNull();
	});

	it('dedupes bulk input', () => {
		const { links, invalid } = parseLinks(
			'https://youtu.be/K0HSD_i2DvA\nhttps://www.youtube.com/watch?v=K0HSD_i2DvA, junk'
		);
		expect(links).toHaveLength(1);
		expect(invalid).toEqual(['junk']);
	});
});
