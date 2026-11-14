import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDeps } from '@/sessions/session-deps';

const loadLiveSession = vi.fn();
const execInRepo = vi.fn();

vi.mock('@/sessions/session-deps', () => ({ sharedSessionDeps: vi.fn() }));
vi.mock('@/sessions/session-record', () => ({ loadLiveSession }));
vi.mock('@/sessions/container-exec', () => ({ execInRepo }));

const { StartBlockedError } = await import('@/sessions/capacity');
const { clearSession } = await import('@/sessions/clear-session');

const container = { id: 'c1' };
const getContainer = vi.fn(() => container);
const deps = { db: {}, docker: { getContainer } } as unknown as SessionDeps;
const ok = { exitCode: 0, stdout: '', stderr: '' };

beforeEach(() => {
  vi.clearAllMocks();
  loadLiveSession.mockResolvedValue({ id: 's1', status: 'idle', containerId: 'c1' });
  execInRepo.mockResolvedValue(ok);
});

describe('clearSession', () => {
  it('empties the input line, sends /clear, then Enter to the claude tmux session', async () => {
    await clearSession('s1', deps);
    expect(getContainer).toHaveBeenCalledWith('c1');
    expect(execInRepo.mock.calls.map(([, c, cmd]) => [c, cmd])).toEqual([
      [container, ['tmux', 'send-keys', '-t', 'claude', 'C-u']],
      [container, ['tmux', 'send-keys', '-t', 'claude', '-l', '--', '/clear']],
      [container, ['tmux', 'send-keys', '-t', 'claude', 'Enter']],
    ]);
  });

  it('refuses when not idle', async () => {
    loadLiveSession.mockResolvedValue({ id: 's1', status: 'working', containerId: 'c1' });
    await expect(clearSession('s1', deps)).rejects.toThrow('Claude can only be cleared while it is idle.');
    await expect(clearSession('s1', deps)).rejects.toBeInstanceOf(StartBlockedError);
    expect(execInRepo).not.toHaveBeenCalled();
  });

  it('refuses a session without a container', async () => {
    loadLiveSession.mockResolvedValue({ id: 's1', status: 'idle', containerId: null });
    await expect(clearSession('s1', deps)).rejects.toBeInstanceOf(StartBlockedError);
    expect(execInRepo).not.toHaveBeenCalled();
  });

  it('reports a failed send-keys', async () => {
    execInRepo.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'no server' });
    await expect(clearSession('s1', deps)).rejects.toThrow('Could not reach Claude in the session.');
    expect(execInRepo).toHaveBeenCalledTimes(1);
    execInRepo.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    await expect(clearSession('s1', deps)).rejects.toBeInstanceOf(StartBlockedError);
  });
});
