import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';
import { getTrack, toTrackDTO } from '$lib/server/pipeline/tracks';

const Body = z.discriminatedUnion('action', [
	z.object({ action: z.literal('cancel') }),
	z.object({ action: z.literal('retry') }),
	z.object({ action: z.literal('bump') }),
	z.object({ action: z.literal('reorder'), beforeId: z.string().nullable() }),
	z.object({ action: z.literal('priority'), priority: z.number().int().min(-10).max(10) })
]);

export const GET: RequestHandler = handler(({ params }) => {
	const t = getTrack(params.id);
	if (!t) error(404, 'Not found');
	return json(toTrackDTO(t));
});

export const POST: RequestHandler = handler(async (event) => {
	const id = event.params.id;
	if (!getTrack(id)) error(404, 'Not found');
	const b = await body(event, Body);
	if (b.action === 'cancel') pipeline.cancel(id);
	if (b.action === 'retry') pipeline.retry(id);
	if (b.action === 'bump') pipeline.bump(id);
	if (b.action === 'reorder') pipeline.reorder(id, b.beforeId);
	if (b.action === 'priority') pipeline.setPriority(id, b.priority);
	return json({ ok: true });
});

export const DELETE: RequestHandler = handler(({ params }) => {
	pipeline.remove(params.id);
	return json({ ok: true });
});
