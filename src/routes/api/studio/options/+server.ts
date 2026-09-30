import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { albumOptions } from '$lib/server/enrich';
import { body, handler } from '$lib/server/http';
import { enrichQueryFor } from '$lib/server/studio/lookup';

/** Albums this file could be tagged from, ranked by confidence (fingerprint-verified when possible). */
export const POST = handler(async (event) => {
	const b = await body(
		event,
		z.object({ id: z.string(), title: z.string().optional(), artist: z.string().optional() })
	);
	const { query } = enrichQueryFor(b.id);
	// The Studio may have staged corrected title/artist that aren't in the file yet
	if (b.title) query.title = b.title;
	if (b.artist) query.artist = b.artist;
	if (!query.title || !query.artist) throw new Error('Needs a title and artist to search');
	const log: string[] = [];
	const options = await albumOptions(query, (l) => log.push(l));
	return json({ options, notes: log });
});
