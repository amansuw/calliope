import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { TRACK_STATUSES } from '$lib/status';
import { body, handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';

const Body = z.discriminatedUnion('action', [
	z.object({ action: z.literal('pause') }),
	z.object({ action: z.literal('resume') }),
	z.object({ action: z.literal('retryFailed') }),
	z.object({ action: z.literal('cancelQueued') }),
	z.object({ action: z.literal('clear'), statuses: z.array(z.enum(TRACK_STATUSES)).min(1) })
]);

export const POST = handler(async (event) => {
	const b = await body(event, Body);
	switch (b.action) {
		case 'pause':
			pipeline.setPaused(true);
			return json({ ok: true });
		case 'resume':
			pipeline.setPaused(false);
			return json({ ok: true });
		case 'retryFailed':
			return json({ count: pipeline.retryAllFailed() });
		case 'cancelQueued':
			return json({ count: pipeline.cancelAllQueued() });
		case 'clear':
			return json({ count: pipeline.clearFinished(b.statuses) });
	}
});
