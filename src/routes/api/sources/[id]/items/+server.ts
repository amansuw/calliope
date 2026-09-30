import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { queueItems, setItemsIgnored, sourceItems } from '$lib/server/sync/sources';

export const GET: RequestHandler = handler(({ params }) => json(sourceItems(params.id)));

const Body = z.object({
	action: z.enum(['queue', 'queueMissing', 'ignore', 'unignore']),
	ids: z.array(z.string()).default([])
});

export const POST: RequestHandler = handler(async (event) => {
	const { action, ids } = await body(event, Body);
	const id = event.params.id;
	if (action === 'queue') return json({ queued: queueItems(id, ids) });
	if (action === 'queueMissing') return json({ queued: queueItems(id) });
	setItemsIgnored(id, ids, action === 'ignore');
	return json({ ok: true });
});
