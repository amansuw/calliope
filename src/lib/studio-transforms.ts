// Pure tag transforms used by the Metadata Studio tools.

export type CaseMode = 'title' | 'sentence' | 'upper' | 'lower';

const SMALL = new Set([
	'a',
	'an',
	'and',
	'as',
	'at',
	'but',
	'by',
	'en',
	'for',
	'if',
	'in',
	'nor',
	'of',
	'on',
	'or',
	'per',
	'the',
	'to',
	'vs',
	'via',
	'feat',
	'ft'
]);

/** Title Case that keeps small words lowercase (except first/last) and leaves acronyms/Roman numerals alone. */
export function titleCase(s: string): string {
	const words = s.split(/(\s+|(?<=[(\[/-])|(?=[)\]/-]))/);
	const idx = words
		.map((w, i) => (/\S/.test(w) && !/^[(\[\])/-]$/.test(w) ? i : -1))
		.filter((i) => i >= 0);
	const firstIdx = idx[0];
	const lastIdx = idx.at(-1);
	return words
		.map((w, i) => {
			if (!/\p{L}/u.test(w)) return w;
			if (/^[A-Z0-9]{2,}$/.test(w)) return w; // DJ, ABBA
			if (/^(?:i{2,3}|iv|vi{1,3}|ix|xi{0,3})$/i.test(w)) return w.toUpperCase(); // Part II, Vol. IV
			const lower = w.toLowerCase();
			const bare = lower.replace(/[.,!?:'"]+$/, '');
			if (i !== firstIdx && i !== lastIdx && SMALL.has(bare)) return lower;
			return lower.replace(
				/^(\P{L}*)(\p{L})/u,
				(_, pre: string, c: string) => pre + c.toUpperCase()
			);
		})
		.join('');
}

export function applyCase(s: string, mode: CaseMode): string {
	switch (mode) {
		case 'upper':
			return s.toUpperCase();
		case 'lower':
			return s.toLowerCase();
		case 'sentence': {
			const lower = s.toLowerCase();
			return lower.replace(
				/^(\P{L}*)(\p{L})/u,
				(_, pre: string, c: string) => pre + c.toUpperCase()
			);
		}
		case 'title':
			return titleCase(s);
	}
}

export interface ReplaceOptions {
	regex: boolean;
	caseSensitive: boolean;
}

export function applyReplace(
	s: string,
	find: string,
	replace: string,
	opts: ReplaceOptions
): string {
	if (!find) return s;
	const flags = opts.caseSensitive ? 'g' : 'gi';
	const pattern = opts.regex
		? new RegExp(find, flags)
		: new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
	return s.replace(pattern, opts.regex ? replace : replace.replace(/\$/g, '$$$$'));
}

export function validRegex(find: string): string | null {
	try {
		new RegExp(find);
		return null;
	} catch (err) {
		return (err as Error).message;
	}
}

const FIELD_ALIASES: Record<string, string> = {
	artist: 'artist',
	title: 'title',
	album: 'album',
	albumartist: 'albumArtist',
	year: 'year',
	track: 'trackNumber',
	tracknumber: 'trackNumber',
	disc: 'discNumber',
	genre: 'genre',
	ignore: '_'
};

/**
 * Parse fields out of a filename with a pattern like "%track% - %artist% - %title%"
 * (or {artist} style). Returns null when the name doesn't fit the pattern.
 */
export function parseWithPattern(name: string, pattern: string): Record<string, string> | null {
	const fields: string[] = [];
	const source = pattern
		.split(/(%[a-z]+%|\{[a-z]+\})/i)
		.map((part) => {
			const m = part.match(/^%([a-z]+)%$|^\{([a-z]+)\}$/i);
			if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
			const key = FIELD_ALIASES[(m[1] ?? m[2]).toLowerCase()];
			if (!key) return part;
			fields.push(key);
			return key === 'trackNumber' || key === 'discNumber' || key === 'year' ? '(\\d+)' : '(.+?)';
		})
		.join('');
	const m = name.match(new RegExp(`^${source}$`, 'i'));
	if (!m) return null;
	const out: Record<string, string> = {};
	fields.forEach((f, i) => {
		if (f !== '_') out[f] = m[i + 1].trim();
	});
	return out;
}
