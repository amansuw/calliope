import { json } from '@sveltejs/kit';
import { and, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { encodeRef, fileParts, guessTags } from '$lib/soulseek';
import { FINISHED_STATUSES } from '$lib/status';
import { db, schema } from '$lib/server/db';
import { body, handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';

const Body = z.object({
	files: z
		.array(
			z.object({
				user: z.string().min(1),
				file: z.string().min(1),
				size: z.number().int().nonnegative(),
				durationSec: z.number().nonnegative().nullish()
			})
		)
		.min(1)
		.max(200),
	top: z.boolean().optional()
});

/** Queue files picked from search results. They keep their own format and tags. */
export const POST = handler(async (event) => {
	const { files, top } = await body(event, Body);
	const refs = files.map((f) => ({ ...f, ref: encodeRef(f) }));
	// Don't queue a file that is already waiting or running
	const pending = new Set(
		db
			.select({ url: schema.tracks.matchUrl })
			.from(schema.tracks)
			.where(
				and(
					inArray(
						schema.tracks.matchUrl,
						refs.map((r) => r.ref)
					),
					notInArray(schema.tracks.status, [...FINISHED_STATUSES])
				)
			)
			.all()
			.map((r) => r.url)
	);
	const fresh = refs.filter((r) => !pending.has(r.ref));

	// The queue shows a format per track: use the file's own extension
	const byExt = Map.groupBy(fresh, (r) => fileParts(r.file).ext || 'file');
	let queued = 0;
	for (const [ext, group] of byExt) {
		const rows = group.map((r) => {
			const guess = guessTags(r.file);
			return {
				provider: 'soulseek' as const,
				title: guess.title,
				artist: guess.artist,
				artists: [guess.artist],
				album: guess.album,
				trackNumber: guess.trackNumber,
				durationMs: r.durationSec ? Math.round(r.durationSec * 1000) : null,
				matchUrl: r.ref,
				matchTitle: `${r.user}: ${fileParts(r.file).name}`,
				// Picked by hand, often to replace a lossy copy already in the library
				force: true
			};
		});
		queued += pipeline.enqueue(rows, { formatPreset: ext, top }).length;
	}
	return json({ queued, alreadyQueued: refs.length - fresh.length });
});
