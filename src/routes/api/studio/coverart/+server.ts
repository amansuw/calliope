import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { findCoverArt } from '$lib/server/studio/musicbrainz';

export const POST = handler(async (event) => {
	const { releaseId, releaseGroupId } = await body(
		event,
		z.object({ releaseId: z.string(), releaseGroupId: z.string().nullish() })
	);
	return json({ url: await findCoverArt(releaseId, releaseGroupId) });
});
