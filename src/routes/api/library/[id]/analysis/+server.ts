import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { getAnalysis } from '$lib/server/library/analysis';

export const GET: RequestHandler = handler(async ({ params }) => {
	const result = await getAnalysis(params.id);
	if (!result) error(404, 'Not found');
	return json(result, { headers: { 'Cache-Control': 'private, max-age=86400' } });
});
