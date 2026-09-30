import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handler } from '$lib/server/http';
import { notifyDiscord } from '$lib/server/integrations/discord';
import { testNavidrome } from '$lib/server/integrations/navidrome';
import { testSpotifyApi } from '$lib/server/sources/spotify';

const Body = z.object({ target: z.enum(['spotify', 'navidrome', 'discord']) });

export const POST = handler(async (event) => {
	const { target } = await body(event, Body);
	if (target === 'spotify') return json({ message: await testSpotifyApi() });
	if (target === 'navidrome') return json({ message: await testNavidrome() });
	await notifyDiscord('completed', 'Calliope test', 'Notifications are working.', true);
	return json({ message: 'Test message sent' });
});
