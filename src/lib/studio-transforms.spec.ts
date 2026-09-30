import { describe, expect, it } from 'vitest';
import { applyCase, applyReplace, parseWithPattern, titleCase } from './studio-transforms';

describe('studio transforms', () => {
	it('title-cases with small words and acronyms', () => {
		expect(titleCase('the sound of the underground')).toBe('The Sound of the Underground');
		expect(titleCase('SONG FOR ABBA')).toBe('SONG FOR ABBA');
		expect(titleCase('live in NYC (part ii)')).toBe('Live in NYC (Part II)');
		expect(titleCase('rock and roll all nite')).toBe('Rock and Roll All Nite');
	});

	it('applies other casing modes', () => {
		expect(applyCase('HELLO world', 'sentence')).toBe('Hello world');
		expect(applyCase('Hello', 'upper')).toBe('HELLO');
	});

	it('replaces literally or by regex', () => {
		expect(
			applyReplace('Song (Official Video)', ' (Official Video)', '', {
				regex: false,
				caseSensitive: false
			})
		).toBe('Song');
		expect(applyReplace('Track 01', '(\\d+)', '#$1', { regex: true, caseSensitive: true })).toBe(
			'Track #01'
		);
		expect(applyReplace('a.b', '.', '$', { regex: false, caseSensitive: true })).toBe('a$b');
	});

	it('parses filenames with patterns', () => {
		expect(
			parseWithPattern('03 - Daft Punk - Digital Love', '%track% - %artist% - %title%')
		).toEqual({
			trackNumber: '03',
			artist: 'Daft Punk',
			title: 'Digital Love'
		});
		expect(parseWithPattern('Muse - Uprising', '{artist} - {title}')).toEqual({
			artist: 'Muse',
			title: 'Uprising'
		});
		expect(parseWithPattern('nomatch', '%artist% - %title%')).toBeNull();
	});
});
