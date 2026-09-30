import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { resolveGroup } from '$lib/server/library/duplicates';

const Body = z.object({
	keepId: z.string(),
	removeIds: z.array(z.string()).min(1),
	mergeTags: z.boolean()
});

export const POST = handler(async (event) => {
	const { keepId, removeIds, mergeTags } = await body(event, Body);
	if (removeIds.includes(keepId)) throw new Error('The keeper cannot also be removed');
	return json(await resolveGroup(keepId, removeIds, mergeTags));
});
