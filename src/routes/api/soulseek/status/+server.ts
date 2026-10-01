import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { soulseek } from '$lib/server/soulseek';

export const GET = handler(() => json(soulseek.status()));
