import fs from 'node:fs';
import { applyCoverArt, readCoverArt, readMetadata, writeTagsBatch } from 'taglib-wasm/simple';

export interface TagWrite {
	title?: string | null;
	artist?: string | null;
	artists?: string[] | null;
	album?: string | null;
	albumArtist?: string | null;
	year?: number | null;
	trackNumber?: number | null;
	trackTotal?: number | null;
	discNumber?: number | null;
	genre?: string | string[] | null;
	isrc?: string | null;
	comment?: string | null;
	lyrics?: string | null;
	mbRecordingId?: string | null;
	mbReleaseId?: string | null;
	mbArtistId?: string | null;
	acoustidId?: string | null;
}

const val = <T>(v: T | null | undefined) => (v === null ? '' : v);

/**
 * Write tags in place (atomic temp-file save inside taglib-wasm).
 * `undefined` leaves a field untouched; `null` clears it.
 */
export async function writeTags(filePath: string, t: TagWrite) {
	const tags: Record<string, unknown> = {};
	const properties: Record<string, string[]> = {};
	const set = (k: string, v: unknown) => v !== undefined && (tags[k] = val(v));

	set('title', t.title);
	if (t.artists !== undefined) tags.artist = t.artists ?? '';
	else set('artist', t.artist);
	set('album', t.album);
	set('albumArtist', t.albumArtist);
	if (t.year !== undefined) tags.year = t.year ?? 0;
	if (t.trackNumber !== undefined) tags.track = t.trackNumber ?? 0;
	if (t.trackTotal !== undefined) tags.totalTracks = t.trackTotal ?? 0;
	if (t.discNumber !== undefined) tags.discNumber = t.discNumber ?? 0;
	set('genre', t.genre);
	set('isrc', t.isrc);
	set('comment', t.comment);
	set('musicbrainzTrackId', t.mbRecordingId);
	set('musicbrainzReleaseId', t.mbReleaseId);
	set('musicbrainzArtistId', t.mbArtistId);
	set('acoustidId', t.acoustidId);
	if (t.lyrics !== undefined) properties.LYRICS = t.lyrics ? [t.lyrics] : [];

	const res = await writeTagsBatch([{ path: filePath, tags, properties }], {
		continueOnError: true
	});
	const item = res.items?.[0] as { status?: string; error?: unknown } | undefined;
	if (item?.status === 'error' || item?.error)
		throw new Error(`Tag write failed: ${String(item.error)}`);
}

export async function writeArtwork(filePath: string, image: Uint8Array, mime: string) {
	const out = await applyCoverArt(filePath, image, mime);
	const tmp = `${filePath}.art-tmp`;
	fs.writeFileSync(tmp, out);
	fs.renameSync(tmp, filePath);
}

export async function fetchImage(url: string): Promise<{ data: Uint8Array; mime: string } | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return null;
		const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
		if (!mime.startsWith('image/') || mime === 'image/webp') return null;
		return { data: new Uint8Array(await res.arrayBuffer()), mime };
	} catch {
		return null;
	}
}

export { readCoverArt, readMetadata };
