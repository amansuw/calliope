import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { startNavidromeScan } from '$lib/server/integrations/navidrome';

/** Ask Navidrome to rescan its library. The outcome follows as a toast when the scan ends. */
export const POST = handler(async (event) => {
	const { full } = await body(event, z.object({ full: z.boolean().optional() }));
	return json(await startNavidromeScan({ full }));
});
