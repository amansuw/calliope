import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { shapeResults } from '$lib/soulseek';
import { body, handler } from '$lib/server/http';
import { soulseek } from '$lib/server/soulseek';

const Body = z.object({
	query: z.string().trim().min(2, 'Type at least two characters').max(200),
	format: z.enum(['flac', 'lossless', 'any']).default('flac')
});

/** Search the Soulseek network. Peers answer for a few seconds; everything received is returned. */
export const POST = handler(async (event) => {
	const { query, format } = await body(event, Body);
	const hits = await soulseek.search(query);
	const groups = shapeResults(hits, { format });
	return json({
		groups,
		total: hits.length,
		shown: groups.reduce((n, g) => n + g.files.length, 0)
	});
});
