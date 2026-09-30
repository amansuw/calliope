import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { syncSource } from '$lib/server/sync/sources';

export const POST: RequestHandler = handler(async ({ params }) =>
	json(await syncSource(params.id))
);
