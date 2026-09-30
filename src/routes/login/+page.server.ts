import { fail, redirect } from '@sveltejs/kit';
import { checkPassword, createSession } from '$lib/server/auth';

// Crude brute-force brake: one attempt per second per process is plenty for a single user.
let lastAttempt = 0;

export const load = ({ locals, url }) => {
	if (locals.authed) redirect(303, url.searchParams.get('next') || '/pipeline');
};

export const actions = {
	default: async ({ request, cookies, url }) => {
		const wait = lastAttempt + 1000 - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastAttempt = Date.now();
		const password = String((await request.formData()).get('password') ?? '');
		if (!(await checkPassword(password))) return fail(401, { error: 'Wrong password' });
		createSession(cookies, url.protocol === 'https:');
		const next = url.searchParams.get('next');
		redirect(303, next?.startsWith('/') && !next.startsWith('//') ? next : '/pipeline');
	}
};
