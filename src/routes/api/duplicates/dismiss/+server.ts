import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { dismissGroup } from '$lib/server/library/duplicates';

export const POST = handler(async (event) => {
	const { key } = await body(event, z.object({ key: z.string().min(1) }));
	dismissGroup(key);
	return json({ ok: true });
});
