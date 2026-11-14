import type Docker from 'dockerode';
import { StartBlockedError } from '@/sessions/capacity';
import { execInRepo } from '@/sessions/container-exec';
import type { SessionDocker } from '@/sessions/session-deps';

const TMUX_SESSION = 'claude';
/**
 * Writes the relaunch request into the runner's state dir (`$STATE_DIR` in supervise.sh; the files are the
 * Task 11 relaunch contract), then ends the tmux session. The markers must be written; the tmux session may
 * already be gone (Claude not running), which is fine.
 */
const RELAUNCH_SCRIPT =
  'printf %s "$1" | base64 -d > "$HOME/.runner/resume-message" && touch "$HOME/.runner/panel-relaunch" && { tmux kill-session -t claude 2>/dev/null || true; }';

export type SessionKeysDeps = { docker: SessionDocker };

const unreachable = () => new StartBlockedError('Could not reach Claude in the session.');

async function send(deps: SessionKeysDeps, container: Docker.Container, cmd: string[]): Promise<string> {
  const result = await execInRepo(deps.docker, container, cmd);
  if (result.exitCode !== 0) throw unreachable();
  return result.stdout;
}

/**
 * Types `text` into the session's Claude Code (tmux) and presses Enter. `escapeFirst` dismisses a menu
 * (such as the usage-limit one) before typing.
 */
export async function typeIntoClaude(
  deps: SessionKeysDeps,
  container: Docker.Container,
  text: string,
  opts: { escapeFirst?: boolean } = {},
): Promise<void> {
  if (opts.escapeFirst) await send(deps, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, 'Escape']);
  // C-u first: a failed Enter must not leave stale text for the next keystrokes to extend.
  await send(deps, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, 'C-u']);
  // `--`: text starting with `-` is typed, not read as flags.
  await send(deps, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, '-l', '--', text]);
  await send(deps, container, ['tmux', 'send-keys', '-t', TMUX_SESSION, 'Enter']);
}

/**
 * The visible pane of Claude Code, or null when there is no `claude` tmux session (tmux exits non-zero: Claude
 * is not running). Throws when the container could not be asked at all (Docker exec failed), which says
 * nothing about Claude.
 */
export async function capturePane(deps: SessionKeysDeps, container: Docker.Container): Promise<string | null> {
  const result = await execInRepo(deps.docker, container, ['tmux', 'capture-pane', '-p', '-t', TMUX_SESSION]);
  return result.exitCode === 0 ? result.stdout : null;
}

/** Asks the runner to restart Claude with `--continue`, passing `message` as its first prompt. */
export async function requestRelaunch(deps: SessionKeysDeps, container: Docker.Container, message: string): Promise<void> {
  const encoded = Buffer.from(message, 'utf8').toString('base64');
  await send(deps, container, ['sh', '-c', RELAUNCH_SCRIPT, 'sh', encoded]);
}
