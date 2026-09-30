import { json } from '@sveltejs/kit';
import { checkBinaries } from '$lib/server/binaries';
import { handler } from '$lib/server/http';

export const GET = handler(async ({ url }) =>
	json(await checkBinaries(url.searchParams.has('refresh')))
);
