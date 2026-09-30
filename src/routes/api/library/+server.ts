import { gzipSync } from 'node:zlib';
import { asc } from 'drizzle-orm';
import { LIBRARY_COLUMNS } from '$lib/library-columns';
import { db, schema } from '$lib/server/db';
import { handler } from '$lib/server/http';

export const GET = handler(({ request }) => {
	const cols = Object.fromEntries(LIBRARY_COLUMNS.map((c) => [c, schema.libraryFiles[c]]));
	const rows = db
		.select(cols)
		.from(schema.libraryFiles)
		.orderBy(
			asc(schema.libraryFiles.albumArtist),
			asc(schema.libraryFiles.album),
			asc(schema.libraryFiles.discNumber),
			asc(schema.libraryFiles.trackNumber)
		)
		.all()
		.map((r) => LIBRARY_COLUMNS.map((c) => (c === 'addedAt' ? (r[c] as Date).getTime() : r[c])));
	const body = JSON.stringify({ columns: LIBRARY_COLUMNS, rows });
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-store'
	};
	if (request.headers.get('accept-encoding')?.includes('gzip')) {
		headers['Content-Encoding'] = 'gzip';
		return new Response(gzipSync(body, { level: 5 }), { headers });
	}
	return new Response(body, { headers });
});
