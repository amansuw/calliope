import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { fingerprintLibrary, fingerprintStats } from '$lib/server/library/duplicates';

export const POST = handler(async () => {
	await fingerprintLibrary();
	return json(fingerprintStats());
});
