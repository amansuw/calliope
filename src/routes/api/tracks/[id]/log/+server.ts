import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';

export const GET: RequestHandler = handler(({ params }) =>
	json({ lines: pipeline.getLog(params.id) })
);
