import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db, schema } from '$lib/server/db';

const MIME: Record<string, string> = {
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.flac': 'audio/flac',
	'.opus': 'audio/ogg; codecs=opus',
	'.ogg': 'audio/ogg',
	'.oga': 'audio/ogg',
	'.wav': 'audio/wav',
	'.aif': 'audio/aiff',
	'.aiff': 'audio/aiff'
};

/** Serve an audio file with HTTP Range support so the player can seek. */
export const GET: RequestHandler = ({ params, request }) => {
	const file = db
		.select({ path: schema.libraryFiles.path })
		.from(schema.libraryFiles)
		.where(eq(schema.libraryFiles.id, params.id))
		.get();
	if (!file || !fs.existsSync(file.path)) error(404, 'File not found');
	const { size } = fs.statSync(file.path);
	const type = MIME[path.extname(file.path).toLowerCase()] ?? 'application/octet-stream';
	const range = request.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);

	const headers: Record<string, string> = {
		'Content-Type': type,
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, max-age=3600'
	};
	if (!range) {
		headers['Content-Length'] = String(size);
		return new Response(Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream, {
			headers
		});
	}
	let start = range[1] ? Number(range[1]) : size - Number(range[2]);
	let end = range[1] && range[2] ? Number(range[2]) : size - 1;
	start = Math.max(0, start);
	end = Math.min(size - 1, end);
	if (start > end)
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
	headers['Content-Length'] = String(end - start + 1);
	return new Response(
		Readable.toWeb(fs.createReadStream(file.path, { start, end })) as ReadableStream,
		{ status: 206, headers }
	);
};
