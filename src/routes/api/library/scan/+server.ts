import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { libraryStatus, scanLibrary } from '$lib/server/library/scanner';

export const POST = handler(async ({ request }) => {
	const { full = false } = await request.json().catch(() => ({}));
	void scanLibrary({ full });
	return json(libraryStatus());
});
