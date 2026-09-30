import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { organize } from '$lib/server/studio/service';

const Body = z.object({
	ids: z.array(z.string()).max(5000),
	template: z.string().min(1),
	dryRun: z.boolean()
});

export const POST = handler(async (event) => {
	const { ids, template, dryRun } = await body(event, Body);
	return json(await organize(ids, template, dryRun));
});
