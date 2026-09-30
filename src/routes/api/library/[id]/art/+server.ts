import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { readCoverArt } from 'taglib-wasm/simple';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db';

function sniff(data: Uint8Array) {
	if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
	if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp';
	return 'image/jpeg';
}

/** Embedded cover art. ETag is tied to the file's mtime so edits in the Studio bust caches. */
export const GET: RequestHandler = async ({ params, request }) => {
	const file = db
		.select({
			path: schema.libraryFiles.path,
			mtimeMs: schema.libraryFiles.mtimeMs,
			hasArtwork: schema.libraryFiles.hasArtwork
		})
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, params.id))
		.get();
	if (!file?.hasArtwork) error(404, 'No artwork');
	const etag = `"${params.id}-${file.mtimeMs}"`;
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304 });
	const data = await readCoverArt(file.path).catch(() => undefined);
	if (!data) error(404, 'No artwork');
	return new Response(Buffer.from(data), {
		headers: { 'Content-Type': sniff(data), ETag: etag, 'Cache-Control': 'private, max-age=86400' }
	});
};
