import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db';
import { handler } from '$lib/server/http';

export const GET: RequestHandler = handler(({ params }) => {
	const file = db
		.select()
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, params.id))
		.get();
	if (!file) error(404, 'Not found');
	const track = file.trackId
		? db.select().from(schema.tracks).where(eq(schema.tracks.id, file.trackId)).get()
		: null;
	const { peaks: _p, fingerprint: _f, ...rest } = file;
	return json({
		...rest,
		folder: path.dirname(file.path),
		addedAt: file.addedAt.getTime(),
		scannedAt: file.scannedAt.getTime(),
		download: track
			? {
					id: track.id,
					matchUrl: track.matchUrl,
					matchScore: track.matchScore,
					provider: track.provider,
					sourceId: track.sourceId,
					finishedAt: track.finishedAt?.getTime() ?? null
				}
			: null
	});
});
