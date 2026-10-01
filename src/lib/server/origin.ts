import type { RequestEvent } from '@sveltejs/kit';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * CSRF guard that works wherever the app is opened (LAN IP, hostname, reverse proxy, tunnel):
 * the browser's Origin must name the host the request was sent to. SvelteKit's own check needs
 * one fixed ORIGIN, which can't cover an app reached at several addresses.
 */
export function isCrossSite(request: Request) {
	if (!UNSAFE.has(request.method)) return false;
	const origin = request.headers.get('origin');
	if (!origin) {
		// Browsers always send Origin on unsafe requests; without one, only form posts are suspect.
		const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		return FORM_TYPES.includes(type);
	}
	let host: string;
	try {
		host = new URL(origin).host;
	} catch {
		return true;
	}
	const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')];
	return !hosts.some((h) => h?.split(',')[0].trim().toLowerCase() === host);
}

/**
 * Whether the browser reached us over https, for the session cookie's Secure flag.
 * Without ORIGIN the Node adapter reports every URL as https, so `url.protocol` alone is unreliable.
 */
export function isHttps({ request, url }: Pick<RequestEvent, 'request' | 'url'>) {
	const forwarded = request.headers.get('x-forwarded-proto');
	if (forwarded) return forwarded.split(',')[0].trim() === 'https';
	return !!process.env.ORIGIN && url.protocol === 'https:';
}
