import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import type { SessionKeysDeps } from '@/auto-resume/session-keys';

const execInRepo = vi.fn();
vi.mock('@/sessions/container-exec', () => ({ execInRepo }));

const { StartBlockedError } = await import('@/sessions/capacity');
const { capturePane, requestRelaunch, typeIntoClaude } = await import('@/auto-resume/session-keys');

const container = { id: 'c1' } as unknown as Docker.Container;
const deps = { docker: {} } as unknown as SessionKeysDeps;
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
const commands = () => execInRepo.mock.calls.map(([, , cmd]) => cmd as string[]);

beforeEach(() => {
  vi.clearAllMocks();
  execInRepo.mockResolvedValue(ok());
});

describe('session keys', () => {
  it('presses Escape first when asked, then types literally', async () => {
    await typeIntoClaude(deps, container, 'Please continue; $HOME "x"', { escapeFirst: true });
    expect(commands()).toEqual([
      ['tmux', 'send-keys', '-t', 'claude', 'Escape'],
      ['tmux', 'send-keys', '-t', 'claude', 'C-u'],
      ['tmux', 'send-keys', '-t', 'claude', '-l', '--', 'Please continue; $HOME "x"'],
      ['tmux', 'send-keys', '-t', 'claude', 'Enter'],
    ]);
  });

  it('types text that starts with a dash as text', async () => {
    await typeIntoClaude(deps, container, '-n keep going');
    expect(commands()).toContainEqual(['tmux', 'send-keys', '-t', 'claude', '-l', '--', '-n keep going']);
  });

  it('stops at the first failed key', async () => {
    execInRepo.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'no server' });
    await expect(typeIntoClaude(deps, container, 'hi', { escapeFirst: true })).rejects.toBeInstanceOf(StartBlockedError);
    expect(execInRepo).toHaveBeenCalledTimes(1);
  });

  it('captures the visible pane', async () => {
    execInRepo.mockResolvedValueOnce(ok('screen'));
    await expect(capturePane(deps, container)).resolves.toBe('screen');
    expect(commands()).toEqual([['tmux', 'capture-pane', '-p', '-t', 'claude']]);
  });

  it('answers null when there is no claude session to capture (tmux exits non-zero)', async () => {
    execInRepo.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: "can't find session" });
    await expect(capturePane(deps, container)).resolves.toBeNull();
  });

  it('throws when the container cannot be asked at all', async () => {
    execInRepo.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(capturePane(deps, container)).rejects.toThrow('socket hang up');
  });

  it('passes the relaunch message as base64 argv, never in the script', async () => {
    const message = 'Keep going "now"\n$(rm -rf /)';
    await requestRelaunch(deps, container, message);
    const [cmd] = commands();
    expect(cmd?.slice(0, 2)).toEqual(['sh', '-c']);
    expect(cmd?.[2]).toBe(
      'printf %s "$1" | base64 -d > "$HOME/.runner/resume-message" && touch "$HOME/.runner/panel-relaunch" && { tmux kill-session -t claude 2>/dev/null || true; }',
    );
    expect(cmd?.slice(3)).toEqual(['sh', Buffer.from(message, 'utf8').toString('base64')]);
  });
});
