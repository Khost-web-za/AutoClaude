import type { LiveEvent } from './event-bus';

export const SSE_RETRY_MS = 3000;
export const SSE_HEARTBEAT_MS = 25_000;

/** The reconnect hint sent once, first, on every stream. */
export const SSE_RETRY_LINE = `retry: ${SSE_RETRY_MS}\n\n`;

/** A comment line: keeps proxies from idling the connection out; EventSource ignores it. */
export const SSE_HEARTBEAT = ': heartbeat\n\n';

/** One event frame: `event: <kind>` plus the whole event as single-line JSON. */
export function formatSse(event: LiveEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}
