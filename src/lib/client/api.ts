import { toasts } from './toasts.svelte';

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

async function request<T>(
	method: string,
	url: string,
	body?: unknown,
	opts: { quiet?: boolean } = {}
): Promise<T> {
	const res = await fetch(url, {
		method,
		headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	if (res.status === 401) {
		location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
		throw new ApiError('Signed out', 401);
	}
	const data = res.headers.get('content-type')?.includes('json')
		? await res.json()
		: await res.text();
	if (!res.ok) {
		const message =
			(typeof data === 'object' && (data.error ?? data.message)) ||
			`Request failed (${res.status})`;
		if (!opts.quiet) toasts.push({ level: 'error', title: 'Something went wrong', message });
		throw new ApiError(message, res.status);
	}
	return data as T;
}

export const api = {
	get: <T>(url: string, opts?: { quiet?: boolean }) => request<T>('GET', url, undefined, opts),
	post: <T>(url: string, body?: unknown, opts?: { quiet?: boolean }) =>
		request<T>('POST', url, body ?? {}, opts),
	patch: <T>(url: string, body: unknown, opts?: { quiet?: boolean }) =>
		request<T>('PATCH', url, body, opts),
	del: <T>(url: string, opts?: { quiet?: boolean }) => request<T>('DELETE', url, undefined, opts)
};
