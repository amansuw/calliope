import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { applyArtworkData } from '$lib/server/studio/service';

/** Multipart upload: `image` file + `ids` (JSON array). */
export const POST = handler(async ({ request }) => {
	const form = await request.formData();
	const image = form.get('image');
	const ids = JSON.parse(String(form.get('ids') ?? '[]')) as string[];
	if (!(image instanceof File) || !image.type.startsWith('image/'))
		throw new Error('Choose a JPEG or PNG image');
	if (image.size > 8 * 1024 * 1024) throw new Error('Image is larger than 8 MB');
	const count = await applyArtworkData(ids, new Uint8Array(await image.arrayBuffer()), image.type);
	return json({ count });
});
