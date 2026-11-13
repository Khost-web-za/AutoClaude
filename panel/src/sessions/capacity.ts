import { and, count, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { sessions } from '@/db/schema';
import type { HostStats } from '@/host/host-stats-types';
import { RUNNING_STATUSES } from '@/sessions/running-statuses';
import { readSettings, type Settings } from '@/settings/settings-store';

const GB = 1024 ** 3;
/** pg_advisory_xact_lock key serialising every "may this session run?" decision. */
export const SESSION_CAPACITY_LOCK = 42;

export { RUNNING_STATUSES };

/** A start that was refused before anything was created; `message` is safe to show. */
export class StartBlockedError extends Error {
  override name = 'StartBlockedError';
}

export class CapacityError extends StartBlockedError {
  override name = 'CapacityError';
  constructor(readonly maxRunning: number) {
    super(`Already running ${maxRunning} sessions (the maximum). Stop one first.`);
  }
}

export class InsufficientDiskError extends StartBlockedError {
  override name = 'InsufficientDiskError';
  constructor(
    readonly freeGb: number,
    readonly minFreeGb: number,
  ) {
    super(`Only ${freeGb.toFixed(1)} GB free on the host; starting needs at least ${minFreeGb} GB.`);
  }
}

export class SysboxMissingError extends StartBlockedError {
  override name = 'SysboxMissingError';
  constructor() {
    super('The Docker host has no sysbox-runc runtime. Install Sysbox or set SESSION_RUNTIME.');
  }
}

/** The Docker daemon could not be asked about Sysbox (R14: never treated as "missing"). */
export class SysboxCheckFailedError extends StartBlockedError {
  override name = 'SysboxCheckFailedError';
  constructor(cause: unknown) {
    super('Could not check the Docker host for the sysbox-runc runtime; is Docker reachable?', { cause });
  }
}

export function assertCapacity(running: number, maxRunning: number): void {
  if (running >= maxRunning) throw new CapacityError(maxRunning);
}

/** Skipped when host stats are unavailable. */
export function assertFreeDisk(stats: HostStats | null, minFreeDiskGb: number): void {
  if (!stats) return;
  if (stats.disk.freeBytes < minFreeDiskGb * GB) {
    throw new InsufficientDiskError(stats.disk.freeBytes / GB, minFreeDiskGb);
  }
}

export type SessionLimits = Pick<
  Settings,
  'maxRunning' | 'cpuPerSession' | 'memoryGbPerSession' | 'diskGbPerSession' | 'minFreeDiskGb'
>;

/** Takes the capacity lock; held until the transaction ends. */
export async function takeCapacityLock(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SESSION_CAPACITY_LOCK})`);
}

/** Live sessions holding a running slot (the footer's "Running n / max" and the New session capacity line). */
export async function countRunningSessions(conn: Db | Tx): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(sessions)
    .where(and(inArray(sessions.status, [...RUNNING_STATUSES]), isNull(sessions.deletedAt)));
  return row?.n ?? 0;
}

/** Takes the capacity lock (released at commit) and reads the limits plus the running count, both inside `tx`. */
export async function lockCapacity(tx: Tx): Promise<{ limits: SessionLimits; running: number }> {
  await takeCapacityLock(tx);
  const [limits, running] = await Promise.all([readSettings(tx), countRunningSessions(tx)]);
  return { limits, running };
}
