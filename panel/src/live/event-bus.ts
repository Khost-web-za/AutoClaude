import type { SessionStatus } from '@/db/schema';
import type { HostStats } from '@/host/host-stats-types';
import type { UsageFailureReason } from '@/usage/usage-client';
import type { UsageSnapshot } from '@/usage/usage-types';

export type LiveEvent =
  | { kind: 'session'; sessionId: string; status: SessionStatus; detail?: string; remoteControlUrl?: string }
  | { kind: 'session_event'; sessionId: string; type: string; at: string }
  | { kind: 'usage'; usage: UsageSnapshot | null; stale: boolean; reason: UsageFailureReason | null }
  | { kind: 'host'; stats: HostStats | null }
  | { kind: 'kickoffs' };

export type LiveListener = (event: LiveEvent) => void;

function createEventBus() {
  const listeners = new Set<LiveListener>();
  return {
    publish(event: LiveEvent): void {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // one broken subscriber must not stop the others or the publisher
        }
      }
    },
    subscribe(listener: LiveListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** For tests and diagnostics: proves streams unsubscribe when their client goes away. */
    listenerCount(): number {
      return listeners.size;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

// Next may load this module separately for instrumentation and for route handlers; share one bus.
const globalForBus = globalThis as typeof globalThis & { __liveEventBus?: EventBus };
export const eventBus: EventBus = (globalForBus.__liveEventBus ??= createEventBus());
