import { eq } from 'drizzle-orm';
import { db, schema } from '../db';

/** The fields enrichment needs from a library file. */
export function enrichQueryFor(id: string) {
	const row = db.select().from(schema.libraryFiles).where(eq(schema.libraryFiles.id, id)).get();
	if (!row) throw new Error('File not found');
	return {
		row,
		query: {
			artist: row.artist ?? '',
			title: row.title ?? '',
			durationMs: row.durationMs,
			album: row.album,
			file: row.path
		}
	};
}
