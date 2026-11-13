import { requireOwner } from '@/auth/require-owner';
import { fetchHostStats } from '@/host/host-stats';
import { eventBus } from '@/live/event-bus';
import { formatSse, SSE_HEARTBEAT, SSE_HEARTBEAT_MS, SSE_RETRY_LINE } from '@/live/sse-format';
import { getUsage } from '@/usage/usage-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** While a stream is open it keeps the cached usage/host readings fresh; they publish to the bus when they refetch. */
const REFRESH_MS = 15_000;

export async function GET(request: Request) {
  await requireOwner();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = eventBus.subscribe((event) => send(formatSse(event)));
      const heartbeat = setInterval(() => send(SSE_HEARTBEAT), SSE_HEARTBEAT_MS);
      const refresh = setInterval(() => {
        // Both read through a cache (60 s / 15 s), so many open tabs still cost one upstream call.
        void Promise.allSettled([getUsage(), fetchHostStats()]);
      }, REFRESH_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(refresh);
        unsubscribe();
        request.signal.removeEventListener('abort', cleanup);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      request.signal.addEventListener('abort', cleanup);
      send(SSE_RETRY_LINE);
      if (request.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
