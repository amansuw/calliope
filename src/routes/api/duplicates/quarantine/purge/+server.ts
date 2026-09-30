import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { purgeQuarantine } from '$lib/server/library/duplicates';

/** Permanent deletion; the UI requires typing a confirmation phrase before calling this. */
export const POST = handler(async (event) => {
	const { ids, confirm } = await body(
		event,
		z.object({ ids: z.array(z.number().int()).min(1), confirm: z.literal('DELETE') })
	);
	void confirm;
	return json({ deleted: purgeQuarantine(ids) });
});
