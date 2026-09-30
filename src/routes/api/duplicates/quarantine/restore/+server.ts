import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { restoreQuarantined } from '$lib/server/library/duplicates';

export const POST = handler(async (event) => {
	const { id } = await body(event, z.object({ id: z.number().int() }));
	return json({ path: await restoreQuarantined(id) });
});
