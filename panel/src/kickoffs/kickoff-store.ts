import { and, asc, count, desc, eq, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { paginate, type PageResult } from '@/db/pagination';
import { windowKickoffs, type KickoffRow } from '@/db/schema';

export const MAX_UPCOMING_KICKOFFS = 20;
const INTERRUPTED_AFTER_MS = 5 * 60_000;

export class KickoffLimitError extends Error {
  constructor() {
    super(`At most ${MAX_UPCOMING_KICKOFFS} kick-offs can be scheduled at once.`);
    this.name = 'KickoffLimitError';
  }
}

/** Scheduled kick-offs, soonest first (capped at 20, so no paging). */
export function listUpcoming(db: Db): Promise<KickoffRow[]> {
  return db
    .select()
    .from(windowKickoffs)
    .where(eq(windowKickoffs.status, 'scheduled'))
    .orderBy(asc(windowKickoffs.runAt));
}

/** Kick-offs that have run (or are running), newest first. */
export function listHistory(db: Db, page: number): Promise<PageResult<KickoffRow>> {
  return paginate(
    db,
    () =>
      db
        .select()
        .from(windowKickoffs)
        .where(ne(windowKickoffs.status, 'scheduled'))
        .orderBy(desc(windowKickoffs.runAt), desc(windowKickoffs.id))
        .$dynamic(),
    { page },
  );
}

export function addKickoff(db: Db, runAt: Date): Promise<KickoffRow> {
  return db.transaction(async (tx) => {
    // Serialise adds so two at once cannot both slip under the limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('window_kickoffs_add'))`);
    const [upcoming] = await tx.select({ n: count() }).from(windowKickoffs).where(eq(windowKickoffs.status, 'scheduled'));
    if ((upcoming?.n ?? 0) >= MAX_UPCOMING_KICKOFFS) throw new KickoffLimitError();
    const [row] = await tx.insert(windowKickoffs).values({ runAt }).returning();
    return row!;
  });
}

export async function rescheduleKickoff(db: Db, id: string, runAt: Date): Promise<boolean> {
  const rows = await db
    .update(windowKickoffs)
    .set({ runAt })
    .where(and(eq(windowKickoffs.id, id), eq(windowKickoffs.status, 'scheduled')))
    .returning({ id: windowKickoffs.id });
  return rows.length > 0;
}

export async function removeKickoff(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(windowKickoffs)
    .where(and(eq(windowKickoffs.id, id), eq(windowKickoffs.status, 'scheduled')))
    .returning({ id: windowKickoffs.id });
  return rows.length > 0;
}

/** Atomically takes every due scheduled kick-off, so each one is handled by exactly one caller. */
export function claimDueKickoffs(db: Db, now: Date): Promise<KickoffRow[]> {
  return db
    .update(windowKickoffs)
    .set({ status: 'running', claimedAt: now })
    .where(and(eq(windowKickoffs.status, 'scheduled'), lte(windowKickoffs.runAt, now)))
    .returning();
}

/** Records how a running kick-off ended; one that is no longer `running` (failed as interrupted) is left alone. */
export async function finishKickoff(
  db: Db,
  id: string,
  result: { status: 'started' | 'skipped' | 'failed'; outcome: string; windowResetsAt?: Date | null },
): Promise<void> {
  await db
    .update(windowKickoffs)
    .set({
      status: result.status,
      outcome: result.outcome,
      windowResetsAt: result.windowResetsAt ?? null,
      finishedAt: new Date(),
    })
    .where(and(eq(windowKickoffs.id, id), eq(windowKickoffs.status, 'running')));
}

/**
 * A kick-off still `running` 5 minutes after it was claimed belongs to a panel that restarted: fail it. Rows
 * claimed before claimed_at existed fall back to their run_at.
 */
export async function failInterrupted(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(windowKickoffs)
    .set({ status: 'failed', outcome: 'Interrupted: the panel restarted', finishedAt: now })
    .where(
      and(
        eq(windowKickoffs.status, 'running'),
        sql`coalesce(${windowKickoffs.claimedAt}, ${windowKickoffs.runAt}) < ${new Date(now.getTime() - INTERRUPTED_AFTER_MS).toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: windowKickoffs.id });
  return rows.length;
}
