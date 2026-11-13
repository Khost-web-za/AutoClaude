import type { SessionStatus } from '@/db/schema';
import type { SessionStatus as DotStatus } from '@/ui/status-dot';

/** `idle` (Claude finished its turn) reads as waiting on the owner. Client-safe. */
export function dotStatus(status: SessionStatus): DotStatus {
  return status === 'idle' ? 'waiting' : status;
}

/** The Remote Control link is only worth opening while the session runs (and not while it boots). */
export function openableRemoteUrl(status: SessionStatus, url: string | null): string | null {
  return status === 'working' || status === 'waiting' || status === 'idle' ? url : null;
}
