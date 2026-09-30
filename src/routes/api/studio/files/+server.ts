import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { loadFiles } from '$lib/server/studio/service';

export const POST = handler(async (event) => {
	const { ids } = await body(event, z.object({ ids: z.array(z.string()).max(2000) }));
	return json(await loadFiles(ids));
});
