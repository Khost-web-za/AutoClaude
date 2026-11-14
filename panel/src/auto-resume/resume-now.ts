import { eq } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { holdsRunningSlot } from '@/sessions/running-statuses';
import { sharedSessionDeps, type SessionDeps } from '@/sessions/session-deps';
import { loadLiveSession } from '@/sessions/session-record';

const ONE_MINUTE_MS = 60_000;

export class ResumeNotApplicableError extends Error {
  override name = 'ResumeNotApplicableError';
  constructor() {
    super('Nothing to resume: the session has no limit to wait out, or its container is not running.');
  }
}

/**
 * Makes a limited or failed session due now: attempts start over, the reset is a minute in the past and the
 * next attempt is this instant, so the resume job's next tick acts on it.
 */
export async function resumeNow(id: string, deps: Pick<SessionDeps, 'db'> = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  const resumable = row.limitState === 'limited' || row.limitState === 'failed';
  if (!resumable || !row.containerId || !holdsRunningSlot(row.status)) throw new ResumeNotApplicableError();
  const now = Date.now();
  await deps.db
    .update(sessions)
    .set({
      limitState: 'limited',
      resumeAttempts: 0,
      limitResetsAt: new Date(now - ONE_MINUTE_MS),
      resumeNextAt: new Date(now),
    })
    .where(eq(sessions.id, row.id));
}
