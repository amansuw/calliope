import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { importLegacy } from '$lib/server/legacy-import';
import { bus } from '$lib/server/events';

const Body = z.object({ path: z.string().min(1) });

export const POST = handler(async (event) => {
	const { path } = await body(event, Body);
	const result = importLegacy(path);
	bus.toast(
		'success',
		'Calliope v1 import finished',
		`${result.sources} sources, ${result.tracks} downloads`
	);
	return json(result);
});
