import { json, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { hasPassword, SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { ensureRuntime } from '$lib/server/runtime';

export const init: ServerInit = async () => {
	await ensureRuntime();
};

const PUBLIC = ['/login', '/setup', '/favicon', '/robots.txt'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (pathname === '/api/health') return resolve(event);
	const isApi = pathname.startsWith('/api/');
	const isPublic =
		PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
		pathname.startsWith('/_app/');

	if (!hasPassword()) {
		if (pathname === '/setup' || pathname.startsWith('/_app/')) return resolve(event);
		if (isApi) return json({ error: 'Setup required' }, { status: 503 });
		redirect(303, '/setup');
	}

	event.locals.authed = validateSession(event.cookies.get(SESSION_COOKIE));
	if (!event.locals.authed && !isPublic) {
		if (isApi) return json({ error: 'Unauthorized' }, { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
	}

	return resolve(event);
};
