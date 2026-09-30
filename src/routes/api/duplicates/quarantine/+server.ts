import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { listQuarantine } from '$lib/server/library/duplicates';

export const GET = handler(() => json(listQuarantine()));
