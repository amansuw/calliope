import { and, eq, isNotNull, sql } from 'drizzle-orm';
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

/** Release IDs handed out before the index knows them: an album's tracks are tagged side by side. */
const handedOut = new Map<string, string>();

/**
 * The MusicBrainz release ID to tag a track of this album with. Players such as Navidrome treat
 * every release ID as an album of its own, and a lookup done per track returns whichever pressing
 * that recording is listed on. So a track takes the ID the album's other tracks already carry;
 * only the first one uses its own (`candidate`).
 */
export function albumReleaseId(
	albumArtist: string | null | undefined,
	album: string | null | undefined,
	candidate: string | null | undefined
): string | null {
	if (!albumArtist || !album) return candidate ?? null;
	const key = `${albumArtist}\u0000${album}`;
	const f = schema.libraryFiles;
	const inLibrary = db
		.select({ id: f.mbReleaseId })
		.from(f)
		.where(and(eq(f.albumArtist, albumArtist), eq(f.album, album), isNotNull(f.mbReleaseId)))
		.groupBy(f.mbReleaseId)
		.orderBy(sql`count(*) desc`, sql`min(${f.addedAt})`)
		.get()?.id;
	const id = inLibrary ?? handedOut.get(key) ?? candidate ?? null;
	if (id) {
		handedOut.delete(key);
		handedOut.set(key, id);
		if (handedOut.size > 500) handedOut.delete(handedOut.keys().next().value!);
	}
	return id;
}
