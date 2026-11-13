import type { SessionStatus } from '@/db/schema';

/** Statuses that hold a running slot. Client-safe (type-only imports). */
export const RUNNING_STATUSES = ['starting', 'working', 'waiting', 'idle'] as const satisfies readonly SessionStatus[];

export const holdsRunningSlot = (status: SessionStatus): boolean =>
  (RUNNING_STATUSES as readonly SessionStatus[]).includes(status);
