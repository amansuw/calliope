import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { releaseExtras } from '$lib/server/enrich';
import { body, handler } from '$lib/server/http';

/** Original year, genres and cover art for an album option the user picked. */
export const POST = handler(async (event) => {
	const b = await body(
		event,
		z.object({
			releaseId: z.string(),
			releaseGroupId: z.string().nullable(),
			year: z.number().nullable(),
			artistId: z.string().nullable()
		})
	);
	return json(
		await releaseExtras(
			{ id: b.releaseId, releaseGroupId: b.releaseGroupId, year: b.year },
			b.artistId
		)
	);
});
