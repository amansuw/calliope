import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { applyEnrichment, enrich } from '$lib/server/enrich';
import { body, handler } from '$lib/server/http';
import { enrichQueryFor } from '$lib/server/studio/lookup';

/** Best match for one file, as a staged patch (nothing is written). */
export const POST = handler(async (event) => {
	const b = await body(
		event,
		z.object({ id: z.string(), title: z.string().optional(), artist: z.string().optional() })
	);
	const { row, query } = enrichQueryFor(b.id);
	if (b.title) query.title = b.title;
	if (b.artist) query.artist = b.artist;
	const e = await enrich({ ...query, album: null });
	return json(
		e ? { enrichment: e, patch: applyEnrichment(row, e) } : { enrichment: null, patch: null }
	);
});
