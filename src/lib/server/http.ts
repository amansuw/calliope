import { error, json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';

/** Parse a JSON body against a schema, answering 400 with a readable message on failure. */
export async function body<T extends z.ZodType>(
	event: RequestEvent,
	schema: T
): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch {
		error(400, 'Expected a JSON body');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		error(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
	}
	return parsed.data;
}

/** Wrap a handler so thrown Errors become `{ error }` JSON instead of a 500 page. */
export function handler<E extends RequestEvent>(fn: (event: E) => Promise<Response> | Response) {
	return async (event: E) => {
		try {
			return await fn(event);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && ('body' in err || 'location' in err))
				throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[api] ${event.request.method} ${event.url.pathname}:`, message);
			return json({ error: message }, { status: 422 });
		}
	};
}
