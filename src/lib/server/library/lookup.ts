import { eq, sql } from 'drizzle-orm';
import { matchKey, normalize } from '$lib/text';
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

export interface AlbumIdentity {
	albumArtist: string | null;
	album: string | null;
	releaseId: string | null;
}

/** Identities handed out before the index knows them: an album's tracks are tagged side by side. */
const handedOut = new Map<string, AlbumIdentity>();

/** The value most of the files carry. */
function commonest<T extends { n: number }>(rows: T[], of: (r: T) => string | null) {
	const count = new Map<string, number>();
	for (const r of rows) {
		const v = of(r);
		if (v) count.set(v, (count.get(v) ?? 0) + r.n);
	}
	return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The spelling of this artist the library's albums already use ("Tool", not "TOOL"). */
function knownArtist(name: string) {
	const f = schema.libraryFiles;
	const known = db
		.select({ albumArtist: f.albumArtist })
		.from(f)
		.where(sql`${f.albumArtist} = ${name} collate nocase`)
		.groupBy(f.albumArtist)
		.orderBy(sql`count(*) desc`)
		.get();
	return known?.albumArtist ?? name;
}

/**
 * How to tag a track so it lands in the album the library already has. Players such as Navidrome
 * split an album whenever its tracks disagree on the album artist or the MusicBrainz release ID,
 * and each source spells these its own way: Spotify says "TOOL", MusicBrainz "Tool", and a lookup
 * done per track returns whichever pressing that recording is listed on. So a track takes the
 * album artist, title spelling and release ID the album's other tracks carry; only the first
 * track of an album uses its own.
 *
 * `albumArtist` is null when the source did not say; the track's `artist` then stands in, unless
 * the library files this album under Various Artists.
 */
export function albumIdentity(q: {
	albumArtist: string | null | undefined;
	artist: string;
	album: string | null | undefined;
	releaseId: string | null | undefined;
}): AlbumIdentity {
	const own = q.albumArtist || q.artist;
	const releaseId = q.releaseId ?? null;
	if (!q.album) return { albumArtist: own ? knownArtist(own) : null, album: null, releaseId };

	const f = schema.libraryFiles;
	const copies = db
		.select({
			albumArtist: f.albumArtist,
			album: f.album,
			releaseId: f.mbReleaseId,
			n: sql<number>`count(*)`
		})
		.from(f)
		.where(sql`${f.album} = ${q.album} collate nocase`)
		.groupBy(f.albumArtist, f.album, f.mbReleaseId)
		.all();
	const by = (artist: string) =>
		copies.filter((c) => normalize(c.albumArtist) === normalize(artist));
	let rows = by(own);
	if (!rows.length && !q.albumArtist) rows = by('Various Artists');

	const key = `${normalize(rows[0]?.albumArtist ?? own)}\u0000${normalize(q.album)}`;
	const earlier = handedOut.get(key);
	const identity = {
		albumArtist: commonest(rows, (r) => r.albumArtist) ?? earlier?.albumArtist ?? knownArtist(own),
		album: commonest(rows, (r) => r.album) ?? earlier?.album ?? q.album,
		releaseId: commonest(rows, (r) => r.releaseId) ?? earlier?.releaseId ?? releaseId
	};
	handedOut.delete(key);
	handedOut.set(key, identity);
	if (handedOut.size > 500) handedOut.delete(handedOut.keys().next().value!);
	return identity;
}
