import { json } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth';

export const POST = ({ cookies }) => {
	destroySession(cookies);
	return json({ ok: true });
};
