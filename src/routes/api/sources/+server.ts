import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { FORMAT_PRESET_IDS } from '$lib/formats';
import { body, handler } from '$lib/server/http';
import { addSource, listSources } from '$lib/server/sync/sources';

export const GET = handler(() => json(listSources()));

const Body = z.object({
	url: z.string().min(1),
	intervalMinutes: z.number().int().min(0).max(10080),
	autoQueue: z.boolean(),
	formatPreset: z.enum(FORMAT_PRESET_IDS).nullish()
});

export const POST = handler(async (event) => json(await addSource(await body(event, Body))));
