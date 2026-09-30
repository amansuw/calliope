import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { saveChanges } from '$lib/server/studio/service';

const Value = z.union([z.string(), z.number(), z.null()]);
const Body = z.object({
	changes: z
		.array(
			z.object({
				id: z.string(),
				tags: z
					.partialRecord(
						z.enum([
							'title',
							'artist',
							'album',
							'albumArtist',
							'year',
							'trackNumber',
							'trackTotal',
							'discNumber',
							'genre',
							'comment'
						]),
						Value
					)
					.optional(),
				mb: z
					.object({
						recordingId: z.string().nullish(),
						releaseId: z.string().nullish(),
						artistId: z.string().nullish()
					})
					.optional(),
				artworkUrl: z.url().nullish(),
				lyrics: z.string().nullish()
			})
		)
		.max(2000)
});

export const POST = handler(async (event) => {
	const { changes } = await body(event, Body);
	return json(await saveChanges(changes));
});
