import type { LibraryRow } from './library-columns';

export type Issue = 'noArt' | 'noLyrics' | 'noAlbum' | 'noYear' | 'noGenre' | 'noTrackNo';
export type Quality = 'all' | 'lossless' | 'high' | 'low';
export type SortKey =
	| 'title'
	| 'artist'
	| 'album'
	| 'year'
	| 'genre'
	| 'durationMs'
	| 'format'
	| 'bitrate'
	| 'size'
	| 'addedAt'
	| 'trackNumber';
export interface SortSpec {
	key: SortKey;
	dir: 1 | -1;
}

export interface LibraryFilter {
	q: string;
	formats: string[];
	quality: Quality;
	issues: Issue[];
	artist: string | null;
	album: string | null;
}

export const ISSUE_LABELS: Record<Issue, string> = {
	noArt: 'No artwork',
	noLyrics: 'No lyrics',
	noAlbum: 'No album',
	noYear: 'No year',
	noGenre: 'No genre',
	noTrackNo: 'No track #'
};

export function hasIssue(r: LibraryRow, issue: Issue): boolean {
	switch (issue) {
		case 'noArt':
			return !r.hasArtwork;
		case 'noLyrics':
			return !r.hasLyrics;
		case 'noAlbum':
			return !r.album;
		case 'noYear':
			return !r.year;
		case 'noGenre':
			return !r.genre;
		case 'noTrackNo':
			return !r.trackNumber;
	}
}

export const haystack = (r: LibraryRow) =>
	[r.title, r.artist, r.album, r.albumArtist, r.genre, r.year, r.relPath]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

export function filterRows(
	rows: LibraryRow[],
	f: LibraryFilter,
	hay: (r: LibraryRow) => string = haystack
): LibraryRow[] {
	const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
	return rows.filter((r) => {
		if (f.artist && (r.albumArtist ?? r.artist) !== f.artist) return false;
		if (f.album && r.album !== f.album) return false;
		if (f.formats.length && !f.formats.includes(r.format ?? '')) return false;
		if (f.quality === 'lossless' && !r.lossless) return false;
		if (f.quality === 'high' && !(r.lossless || (r.bitrate ?? 0) >= 256)) return false;
		if (f.quality === 'low' && (r.lossless || (r.bitrate ?? 0) >= 192)) return false;
		for (const issue of f.issues) if (!hasIssue(r, issue)) return false;
		if (terms.length) {
			const h = hay(r);
			for (const t of terms) if (!h.includes(t)) return false;
		}
		return true;
	});
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compare(a: LibraryRow, b: LibraryRow, key: SortKey): number {
	const va = a[key];
	const vb = b[key];
	// Empty values always sink to the bottom, whatever the direction
	if (va == null || va === '') return vb == null || vb === '' ? 0 : 2;
	if (vb == null || vb === '') return -2;
	if (typeof va === 'string' && typeof vb === 'string') return collator.compare(va, vb);
	return (va as number) - (vb as number);
}

/** Multi-key sort. Album order falls back to disc/track number so albums read naturally. */
export function sortRows(rows: LibraryRow[], specs: SortSpec[]): LibraryRow[] {
	if (!specs.length) return rows;
	return [...rows].sort((a, b) => {
		for (const { key, dir } of specs) {
			const c = compare(a, b, key);
			if (c === 2 || c === -2) return c;
			if (c) return c * dir;
			if (key === 'album') {
				const d =
					(a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
				if (d) return d;
			}
		}
		return 0;
	});
}
