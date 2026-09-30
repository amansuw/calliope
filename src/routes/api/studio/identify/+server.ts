import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { identify } from '$lib/server/studio/acoustid';

export const POST = handler(async (event) => {
	const { id } = await body(event, z.object({ id: z.string() }));
	return json(await identify(id));
});
