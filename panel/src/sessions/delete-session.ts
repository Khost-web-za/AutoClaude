import { sql } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { dockerErrorDetail, dockerStatusCode } from '@/docker/docker-errors';
import { sessionDockerVolumeName } from './container-spec';
import { needsConfirmation } from './delete-confirmation';
import { refreshGitState, type GitState } from './git-state';
import { sharedSessionDeps, type SessionDeps, type SessionDocker } from './session-deps';
import { loadLiveSession, setSessionStatus } from './session-record';

/**
 * The workspace has unpushed or uncommitted work, or its state could not be read (`gitState.error`):
 * deleting needs the repo name typed.
 */
export class DeleteNeedsConfirmationError extends Error {
  override name = 'DeleteNeedsConfirmationError';
  constructor(readonly gitState: GitState) {
    super(
      gitState.error
        ? "Can't verify the workspace's git state; type the repository name to delete anyway."
        : 'The workspace has work that is not pushed; type the repository name to delete anyway.',
    );
  }
}

export { needsConfirmation };

const ignoreMissing = (error: unknown) => {
  if (dockerStatusCode(error) !== 404) throw error;
};

/** Removes the session container (with anonymous volumes) and its named docker volume; missing is fine. */
export async function removeSessionResources(
  docker: SessionDocker,
  containerId: string | null,
  sessionId: string,
): Promise<void> {
  try {
    if (containerId) await docker.getContainer(containerId).remove({ force: true, v: true }).catch(ignoreMissing);
    await docker.getVolume(sessionDockerVolumeName(sessionId)).remove().catch(ignoreMissing);
  } catch (error) {
    console.warn(`[sessions] cleanup of session ${sessionId} failed: ${dockerErrorDetail(error)}`);
    throw error;
  }
}

/**
 * Deletes a session. The git state is always re-read first; unknown, unpushed or uncommitted work needs
 * `typedRepoName === repoFullName`, otherwise DeleteNeedsConfirmationError carries the state for the dialog.
 */
export async function deleteSession(
  id: string,
  confirmation: { typedRepoName?: string },
  deps: SessionDeps = sharedSessionDeps(),
): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  const gitState = await refreshGitState(row.id, deps);
  if (needsConfirmation(gitState) && confirmation.typedRepoName?.trim() !== row.repoFullName) {
    throw new DeleteNeedsConfirmationError(gitState);
  }
  await removeSessionResources(deps.docker, row.containerId, row.id);
  await setSessionStatus(deps, row.id, 'stopped', null, {
    deletedAt: new Date(),
    endedAt: sql`coalesce(${sessions.endedAt}, now())`,
  });
}
