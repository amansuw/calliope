import { describe, expect, it } from 'vitest';
import { renderTemplate } from './template';

describe('renderTemplate', () => {
	const tpl = '{albumartist|artist}/{album|Singles}/[{track:02} - ]{title}';

	it('renders a full album path', () => {
		expect(
			renderTemplate(tpl, {
				artist: 'Daft Punk',
				album: 'Discovery',
				track: 1,
				title: 'One More Time'
			})
		).toBe('Daft Punk/Discovery/01 - One More Time');
	});

	it('uses fallbacks and drops empty optional sections', () => {
		expect(renderTemplate(tpl, { artist: 'Muse', title: 'Uprising' })).toBe(
			'Muse/Singles/Uprising'
		);
	});

	it('sanitizes path separators inside values', () => {
		expect(renderTemplate('{artist}/{title}', { artist: 'AC/DC', title: 'What? Why: "Now"' })).toBe(
			'AC_DC/What_ Why_ _Now_'
		);
	});

	it('prefers album artist', () => {
		expect(renderTemplate('{albumartist|artist}', { artist: 'A feat. B', albumartist: 'A' })).toBe(
			'A'
		);
	});
});
