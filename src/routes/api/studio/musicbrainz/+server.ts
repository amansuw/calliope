import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { searchRecordings } from '$lib/server/studio/musicbrainz';

const Body = z.object({
	title: z.string().min(1),
	artist: z.string().nullish(),
	album: z.string().nullish(),
	durationMs: z.number().nullish()
});

export const POST = handler(async (event) => json(await searchRecordings(await body(event, Body))));
