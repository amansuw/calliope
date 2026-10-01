import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';
import { publicSettings, updateSettings } from '$lib/server/settings';
import { scheduleRescan } from '$lib/server/library/scanner';
import { soulseek } from '$lib/server/soulseek';

export const GET = handler(() => json(publicSettings()));

export const PATCH = handler(async ({ request }) => {
	const patch = await request.json();
	try {
		updateSettings(patch);
	} catch (err) {
		// Surface zod's first issue in a readable form
		const issue = (err as { issues?: { path: string[]; message: string }[] }).issues?.[0];
		throw new Error(issue ? `${issue.path.join('.')}: ${issue.message}` : (err as Error).message);
	}
	pipeline.tick(); // concurrency may have changed
	soulseek.sync();
	scheduleRescan();
	return json(publicSettings());
});
