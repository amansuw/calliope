import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { queueUpgrades, upgradedFiles } from '$lib/server/studio/upgrade';

/** Look on Soulseek for lossless copies of these library files. */
export const POST = handler(async (event) => {
	const { ids } = await body(event, z.object({ ids: z.array(z.string()).min(1).max(2000) }));
	return json(await queueUpgrades(ids));
});

/** Which library file each finished upgrade became: `?tracks=a,b` */
export const GET = handler((event) => {
	const tracks = (event.url.searchParams.get('tracks') ?? '').split(',').filter(Boolean);
	return json(upgradedFiles(tracks.slice(0, 2000)));
});
