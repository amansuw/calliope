/**
 * The library listing is sent as rows of tuples (not objects) to keep large collections light.
 * Shared by the API and the Explorer so both agree on column order.
 */
export const LIBRARY_COLUMNS = [
	'id',
	'title',
	'artist',
	'album',
	'albumArtist',
	'year',
	'genre',
	'trackNumber',
	'discNumber',
	'durationMs',
	'format',
	'codec',
	'bitrate',
	'sampleRate',
	'bitsPerSample',
	'lossless',
	'size',
	'hasArtwork',
	'hasLyrics',
	'relPath',
	'addedAt',
	'mtimeMs'
] as const;

export interface LibraryRow {
	id: string;
	title: string | null;
	artist: string | null;
	album: string | null;
	albumArtist: string | null;
	year: number | null;
	genre: string | null;
	trackNumber: number | null;
	discNumber: number | null;
	durationMs: number | null;
	format: string | null;
	codec: string | null;
	bitrate: number | null;
	sampleRate: number | null;
	bitsPerSample: number | null;
	lossless: boolean | null;
	size: number;
	hasArtwork: boolean;
	hasLyrics: boolean;
	relPath: string;
	addedAt: number;
	mtimeMs: number;
}

export function decodeRows(rows: unknown[][]): LibraryRow[] {
	return rows.map((r) => {
		const o: Record<string, unknown> = {};
		LIBRARY_COLUMNS.forEach((c, i) => (o[c] = r[i]));
		return o as unknown as LibraryRow;
	});
}
