import { eq } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession } from './session-record';

/** Turns auto-resume on or off for one session. Turning it off also forgets any limit it was waiting on. */
export async function setAutoResume(id: string, enabled: boolean, deps: Pick<SessionDeps, 'db'> = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  const values = enabled
    ? { autoResume: true }
    : { autoResume: false, limitState: 'none' as const, resumeAttempts: 0, limitResetsAt: null, resumeNextAt: null, limitDetail: null };
  await deps.db.update(sessions).set(values).where(eq(sessions.id, row.id));
}
