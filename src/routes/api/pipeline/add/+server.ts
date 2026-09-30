import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { FORMAT_PRESET_IDS } from '$lib/formats';
import { body, handler } from '$lib/server/http';
import { pipeline } from '$lib/server/pipeline/queue';
import { parseLinks } from '$lib/server/sources/parse';
import { listCollection, remoteToTrackRow } from '$lib/server/sync/sources';

const Body = z.object({
	input: z.string().min(1),
	formatPreset: z.enum(FORMAT_PRESET_IDS).nullish(),
	top: z.boolean().optional()
});

/** Queue pasted links. Tracks go straight in; playlists/albums/channels are expanded once. */
export const POST = handler(async (event) => {
	const { input, formatPreset, top } = await body(event, Body);
	const { links, invalid } = parseLinks(input);
	if (!links.length)
		throw new Error(
			invalid.length ? `Unrecognized: ${invalid.slice(0, 3).join(', ')}` : 'No links found'
		);

	let queued = 0;
	const errors: string[] = [];
	for (const link of links) {
		try {
			if (link.kind === 'track') {
				pipeline.enqueue(
					[
						{
							provider: link.provider,
							requestedUrl: link.url,
							spotifyId: link.provider === 'spotify' ? link.id : null,
							youtubeId: link.provider === 'youtube' ? link.id : null,
							force: true
						}
					],
					{ formatPreset, top }
				);
				queued++;
			} else {
				const collection = await listCollection(link);
				const rows = collection.items.map((item) => ({
					...remoteToTrackRow(link.provider, item, link.url),
					album: item.album ?? (link.kind === 'album' ? collection.name : null),
					artworkUrl: item.artworkUrl ?? (link.kind === 'album' ? collection.artworkUrl : null)
				}));
				queued += pipeline.enqueue(rows, { formatPreset, top }).length;
			}
		} catch (err) {
			errors.push(`${link.url}: ${(err as Error).message}`);
		}
	}
	return json({ queued, invalid, errors });
});
