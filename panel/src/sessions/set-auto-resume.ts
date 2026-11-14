import { eq } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession, publishLimitCleared } from './session-record';
import { CLEARED_LIMIT } from './session-status';

/** Turns auto-resume on or off for one session. Turning it off also forgets any limit it was waiting on. */
export async function setAutoResume(
  id: string,
  enabled: boolean,
  deps: Pick<SessionDeps, 'db' | 'eventBus'> = sharedSessionDeps(),
): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  const values = enabled ? { autoResume: true } : { autoResume: false, ...CLEARED_LIMIT };
  await deps.db.update(sessions).set(values).where(eq(sessions.id, row.id));
  if (!enabled && row.limitState !== 'none') publishLimitCleared(deps, row.id);
}
