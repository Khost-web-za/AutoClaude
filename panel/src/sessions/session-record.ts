import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { sessions, type SessionStatus } from '@/db/schema';
import type { SessionDeps } from './session-deps';

export type SessionRow = typeof sessions.$inferSelect;

export class SessionNotFoundError extends Error {
  override name = 'SessionNotFoundError';
  constructor(readonly sessionId: string) {
    super('Session not found');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSessionId = (value: string) => UUID.test(value);

/** The session unless it is unknown or deleted. */
export async function loadLiveSession(db: Db, id: string): Promise<SessionRow> {
  const [row] = isSessionId(id)
    ? await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id.toLowerCase()), isNull(sessions.deletedAt)))
    : [];
  if (!row) throw new SessionNotFoundError(id);
  return row;
}

/**
 * Writes a status change (plus any extra columns) and announces it on the live bus. With `onlyIf` the write
 * is a compare-and-set: it applies (and publishes) only while the row still matches; returns whether it did.
 */
export async function setSessionStatus(
  deps: Pick<SessionDeps, 'db' | 'eventBus'>,
  id: string,
  status: SessionStatus,
  detail: string | null,
  extra: Omit<PgUpdateSetSource<typeof sessions>, 'id' | 'status' | 'statusDetail'> = {},
  onlyIf?: SQL,
): Promise<boolean> {
  const updated = await deps.db
    .update(sessions)
    .set({ ...extra, status, statusDetail: detail })
    .where(onlyIf ? and(eq(sessions.id, id), onlyIf) : eq(sessions.id, id))
    .returning({ id: sessions.id });
  if (updated.length === 0) return false;
  deps.eventBus.publish({ kind: 'session', sessionId: id, status, ...(detail !== null ? { detail } : {}) });
  return true;
}
