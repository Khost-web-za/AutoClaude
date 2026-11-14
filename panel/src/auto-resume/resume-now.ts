import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { holdsRunningSlot } from '@/sessions/running-statuses';
import { sharedSessionDeps, type SessionDeps } from '@/sessions/session-deps';
import { loadLiveSession } from '@/sessions/session-record';

const ONE_MINUTE_MS = 60_000;
const RESUMABLE_STATES = ['limited', 'failed'] as const;

export class ResumeNotApplicableError extends Error {
  override name = 'ResumeNotApplicableError';
  constructor() {
    super('Nothing to resume: the session has no limit to wait out, or its container is not running.');
  }
}

/**
 * Makes a limited or failed session due now: attempts start over, the reset is a minute in the past, the next
 * attempt is this instant and any failure text is gone, so the resume job's next tick acts on it. The write is a
 * compare-and-set on what was read: a step the job claimed meanwhile (it moves resume_next_at) is left alone.
 */
export async function resumeNow(id: string, deps: Pick<SessionDeps, 'db' | 'eventBus'> = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  const resumable = (RESUMABLE_STATES as readonly string[]).includes(row.limitState);
  if (!resumable || !row.containerId || !holdsRunningSlot(row.status)) throw new ResumeNotApplicableError();
  const now = Date.now();
  const resumeNextAt = new Date(now);
  const [updated] = await deps.db
    .update(sessions)
    .set({
      limitState: 'limited',
      resumeAttempts: 0,
      limitResetsAt: new Date(now - ONE_MINUTE_MS),
      resumeNextAt,
      limitDetail: null,
    })
    .where(
      and(
        eq(sessions.id, row.id),
        inArray(sessions.limitState, [...RESUMABLE_STATES]),
        row.resumeNextAt ? eq(sessions.resumeNextAt, row.resumeNextAt) : isNull(sessions.resumeNextAt),
      ),
    )
    .returning({ id: sessions.id });
  if (!updated) throw new ResumeNotApplicableError();
  deps.eventBus.publish({
    kind: 'session_limit',
    sessionId: row.id,
    limitState: 'limited',
    resumeAt: resumeNextAt.toISOString(),
    detail: null,
  });
}
