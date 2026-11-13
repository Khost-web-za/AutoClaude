'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/auth/require-owner';
import { StackDiscoveryError } from '@/docker/self-discovery';
import { getPanelEnv } from '@/env/panel-env';
import { RepoNotAccessibleError } from '@/github/repos';
import { UnknownProfileError } from '@/profiles/merge-plan';
import { listProfiles } from '@/profiles/profile-catalog';
import { assertRepoAccessible, repoAccessFailure } from '@/repos/repo-access';
import { CapacityError, InsufficientDiskError, StartBlockedError, SysboxCheckFailedError, SysboxMissingError } from './capacity';
import { deleteSession, DeleteNeedsConfirmationError } from './delete-session';
import { refreshGitState } from './git-state';
import { validateNewSession } from './new-session-schema';
import type {
  DeleteSessionResult,
  SessionActionResult,
  SessionFailure,
  StartSessionResult,
  WorkStateResult,
} from './session-action-result';
import { isSessionId, SessionNotFoundError } from './session-record';
import { restartSession, startSession } from './start-session';
import { stopSession } from './stop-session';

/** Turns an orchestrator error into a typed, display-safe result. Unknown errors are logged by name only. */
function failure(action: string, error: unknown): SessionFailure {
  if (error instanceof CapacityError) return { ok: false, reason: 'capacity', message: error.message };
  if (error instanceof InsufficientDiskError) return { ok: false, reason: 'disk', message: error.message };
  if (error instanceof SysboxMissingError || error instanceof SysboxCheckFailedError) {
    return { ok: false, reason: 'sysbox', message: error.message };
  }
  // Deployment wiring (network, volume): the message names the fix and holds no secret.
  if (error instanceof StackDiscoveryError) return { ok: false, reason: 'blocked', message: error.message };
  if (error instanceof StartBlockedError) return { ok: false, reason: 'blocked', message: error.message };
  if (error instanceof SessionNotFoundError) {
    return { ok: false, reason: 'not-found', message: 'That session no longer exists.' };
  }
  if (error instanceof UnknownProfileError) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'A config profile is missing from this deployment. Reload and pick again.',
      fieldErrors: { profiles: ['Pick from the profiles shown; the list may have changed. Reload.'] },
    };
  }
  if (error instanceof RepoNotAccessibleError) {
    return { ok: false, reason: 'invalid', message: repoAccessFailure(error), fieldErrors: { repoFullName: [repoAccessFailure(error)] } };
  }
  console.error(`[sessions] ${action} failed:`, error instanceof Error ? error.name : 'error');
  return { ok: false, reason: 'unavailable', message: `Could not ${action}. Docker or the database may be unreachable; try again.` };
}

const invalidId: SessionFailure = { ok: false, reason: 'invalid', message: 'That is not a session id.' };

/** Every page that shows sessions, the footer's running count and the session's own pages. */
function revalidateSessions(): void {
  revalidatePath('/', 'layout');
}

/**
 * Starts a session from the New session form. The request is validated server-side (limits, profiles, a
 * repository the App can see) and started under GitHub's canonical repository name.
 */
export async function startSessionAction(request: unknown): Promise<StartSessionResult> {
  await requireOwner();
  let catalog;
  try {
    catalog = await listProfiles(getPanelEnv().configsDir);
  } catch (error) {
    console.error('[sessions] reading the config profiles failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, reason: 'unavailable', message: 'Could not read the config profiles of this deployment. Try again.' };
  }
  let validation;
  try {
    validation = await validateNewSession(request, { profiles: catalog.profiles, resolveRepo: assertRepoAccessible });
  } catch (error) {
    // validateNewSession only throws what GitHub threw (an outage); "not accessible" is a field error.
    return { ok: false, reason: 'unavailable', message: repoAccessFailure(error) };
  }
  if (!validation.ok) {
    return { ok: false, reason: 'invalid', message: 'Check the highlighted fields.', fieldErrors: validation.fieldErrors };
  }
  try {
    const { sessionId } = await startSession(validation.input);
    revalidateSessions();
    return { ok: true, sessionId };
  } catch (error) {
    return failure('start the session', error);
  }
}

/** Stops the container (the workspace is kept). */
export async function stopSessionAction(id: unknown): Promise<SessionActionResult> {
  await requireOwner();
  if (typeof id !== 'string' || !isSessionId(id)) return invalidId;
  try {
    await stopSession(id);
  } catch (error) {
    return failure('stop the session', error);
  }
  revalidateSessions();
  return { ok: true, message: 'Session stopped. Its workspace is kept.' };
}

/** Restarts a running session's container, or starts a stopped one again (needs a free slot). */
export async function restartSessionAction(id: unknown): Promise<SessionActionResult> {
  await requireOwner();
  if (typeof id !== 'string' || !isSessionId(id)) return invalidId;
  try {
    await restartSession(id);
  } catch (error) {
    return failure('restart the session', error);
  }
  revalidateSessions();
  return { ok: true, message: 'Session restarting.' };
}

/**
 * Deletes a session. The git state is re-read on the server first; unpushed, uncommitted or unknown work
 * needs `typedRepoName` to equal the repository name, otherwise the state comes back for the dialog.
 */
export async function deleteSessionAction(id: unknown, typedRepoName?: unknown): Promise<DeleteSessionResult> {
  await requireOwner();
  if (typeof id !== 'string' || !isSessionId(id)) return invalidId;
  const typed = typeof typedRepoName === 'string' ? typedRepoName.slice(0, 200) : undefined;
  try {
    await deleteSession(id, { typedRepoName: typed });
  } catch (error) {
    if (error instanceof DeleteNeedsConfirmationError) {
      return {
        ok: false,
        reason: 'needs-confirmation',
        needsConfirmation: true,
        gitState: error.gitState,
        message: error.message,
      };
    }
    return failure('delete the session', error);
  }
  revalidateSessions();
  return { ok: true, message: 'Session deleted.' };
}

/** Re-reads the workspace's git state (work state refresh, the delete dialog's live check). */
export async function refreshWorkStateAction(id: unknown): Promise<WorkStateResult> {
  await requireOwner();
  if (typeof id !== 'string' || !isSessionId(id)) return invalidId;
  try {
    return { ok: true, gitState: await refreshGitState(id) };
  } catch (error) {
    return failure('check the workspace', error);
  }
}
