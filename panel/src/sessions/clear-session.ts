import { StartBlockedError } from './capacity';
import { execInRepo } from './container-exec';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession } from './session-record';

const TMUX_SESSION = 'claude';
const unreachable = () => new StartBlockedError('Could not reach Claude in the session.');

/**
 * Types `/clear` into the session's Claude Code (tmux) and presses Enter. Only an idle Claude takes it:
 * mid-turn the text would land in a dialog or the queue. The runner's SessionStart hook then syncs the workspace.
 */
export async function clearSession(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  if (row.status !== 'idle' || !row.containerId) {
    throw new StartBlockedError('Claude can only be cleared while it is idle.');
  }
  const container = deps.docker.getContainer(row.containerId);
  // C-u first: a failed Enter must not leave a stale `/clear` for the next keystrokes to extend.
  const emptied = await execInRepo(deps.docker, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, 'C-u']);
  if (emptied.exitCode !== 0) throw unreachable();
  const typed = await execInRepo(deps.docker, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, '-l', '/clear']);
  if (typed.exitCode !== 0) throw unreachable();
  const submitted = await execInRepo(deps.docker, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, 'Enter']);
  if (submitted.exitCode !== 0) throw unreachable();
}
