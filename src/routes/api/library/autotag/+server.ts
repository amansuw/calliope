import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { autoTagFiles } from '$lib/server/library/autotag';

const Body = z.object({
	ids: z.array(z.string()).min(1).max(5000),
	organize: z.boolean().default(true)
});

export const POST = handler(async (event) => {
	const { ids, organize } = await body(event, Body);
	return json(autoTagFiles(ids, { organize }));
});
