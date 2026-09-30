import { json } from '@sveltejs/kit';
import { bin, checkBinaries } from '$lib/server/binaries';
import { handler } from '$lib/server/http';
import { run } from '$lib/server/proc';

/**
 * Self-update yt-dlp. Works for the standalone binary and zipapp; pip installs report that they
 * must be updated with pip (the Docker entrypoint does that on start when YTDLP_AUTO_UPDATE=1).
 */
export const POST = handler(async () => {
	const res = await run(bin('ytdlp'), ['-U'], { timeoutMs: 180_000 });
	const output = `${res.stdout}\n${res.stderr}`.trim();
	const statuses = await checkBinaries(true);
	return json({ ok: res.code === 0, output, statuses });
});
