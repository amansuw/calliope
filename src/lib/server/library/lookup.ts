import { eq } from 'drizzle-orm';
import { matchKey } from '$lib/text';
import { db, schema } from '../db';

/** Is a song with this artist/title already on disk? */
export function findInLibrary(artist: string | null | undefined, title: string | null | undefined) {
	const key = matchKey(artist, title);
	if (!key) return undefined;
	return db
		.select({ id: schema.libraryFiles.id, path: schema.libraryFiles.path })
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.matchKey, key))
		.get();
}
