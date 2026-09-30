import { json } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';

export const GET = () => {
	sqlite.prepare('select 1').get();
	return json({ ok: true });
};
