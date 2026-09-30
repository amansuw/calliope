import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { FORMAT_PRESET_IDS } from '$lib/formats';
import { body, handler } from '$lib/server/http';
import { deleteSource, getSource, toSourceDTO, updateSource } from '$lib/server/sync/sources';

const Patch = z.object({
	enabled: z.boolean().optional(),
	autoQueue: z.boolean().optional(),
	intervalMinutes: z.number().int().min(0).max(10080).optional(),
	formatPreset: z.enum(FORMAT_PRESET_IDS).nullable().optional(),
	name: z.string().min(1).max(200).optional()
});

export const GET: RequestHandler = handler(({ params }) => {
	const s = getSource(params.id);
	if (!s) error(404, 'Not found');
	return json(toSourceDTO(s));
});

export const PATCH: RequestHandler = handler(async (event) => {
	updateSource(event.params.id, await body(event, Patch));
	return json({ ok: true });
});

export const DELETE: RequestHandler = handler(({ params }) => {
	deleteSource(params.id);
	return json({ ok: true });
});
