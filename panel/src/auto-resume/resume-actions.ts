'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/auth/require-owner';
import type { SessionActionResult } from '@/sessions/session-action-result';
import { isSessionId, SessionNotFoundError } from '@/sessions/session-record';
import { ResumeNotApplicableError, resumeNow } from './resume-now';

/** Resume now: asks for an immediate resume of a limited or failed session; the next 30 s tick does it. */
export async function resumeNowAction(id: unknown): Promise<SessionActionResult> {
  await requireOwner();
  if (typeof id !== 'string' || !isSessionId(id)) return { ok: false, reason: 'invalid', message: 'That is not a session id.' };
  try {
    await resumeNow(id);
  } catch (error) {
    if (error instanceof SessionNotFoundError) return { ok: false, reason: 'not-found', message: 'That session no longer exists.' };
    if (error instanceof ResumeNotApplicableError) return { ok: false, reason: 'blocked', message: error.message };
    console.error('[auto-resume] resume now failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, reason: 'unavailable', message: 'Could not resume the session. The database may be unreachable; try again.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Resuming within 30 seconds.' };
}
