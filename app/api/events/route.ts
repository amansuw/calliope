import { addSSEListener, removeSSEListener } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const listener = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      addSSEListener(listener);

      // Send initial heartbeat
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeat);
        removeSSEListener(listener);
      };

      // The stream will be cancelled when the client disconnects
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));

      // Store cleanup for cancel
      (stream as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel() {
      // Try to call cleanup
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
