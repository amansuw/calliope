import type { RequestHandler } from './$types';
import { bus } from '$lib/server/events';
import { pipeline } from '$lib/server/pipeline/queue';

export const GET: RequestHandler = ({ request }) => {
	let unsubscribe = () => {};
	let heartbeat: NodeJS.Timeout;
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					cleanup();
				}
			};
			const cleanup = () => {
				unsubscribe();
				clearInterval(heartbeat);
			};
			send('telemetry', pipeline.telemetry());
			unsubscribe = bus.subscribe(send);
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					cleanup();
				}
			}, 15_000);
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			unsubscribe();
			clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
