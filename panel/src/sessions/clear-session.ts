import { typeIntoClaude } from '@/auto-resume/session-keys';
import { StartBlockedError } from './capacity';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession } from './session-record';

/**
 * Types `/clear` into the session's Claude Code (tmux) and presses Enter. Only an idle Claude takes it:
 * mid-turn the text would land in a dialog or the queue. The runner's SessionStart hook then syncs the workspace.
 */
export async function clearSession(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  if (row.status !== 'idle' || !row.containerId) {
    throw new StartBlockedError('Claude can only be cleared while it is idle.');
  }
  await typeIntoClaude(deps, deps.docker.getContainer(row.containerId), '/clear');
}
