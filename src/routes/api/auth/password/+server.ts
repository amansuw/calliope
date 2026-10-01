import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { checkPassword, createSession, setPassword } from '$lib/server/auth';
import { body, handler } from '$lib/server/http';
import { isHttps } from '$lib/server/origin';

const Body = z.object({
	current: z.string(),
	next: z.string().min(8, 'Use at least 8 characters')
});

export const POST = handler(async (event) => {
	const { current, next } = await body(event, Body);
	if (!(await checkPassword(current))) throw new Error('Current password is wrong');
	await setPassword(next);
	createSession(event.cookies, isHttps(event));
	return json({ ok: true });
});
