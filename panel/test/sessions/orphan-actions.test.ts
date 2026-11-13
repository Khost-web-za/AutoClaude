import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const listOrphans = vi.fn();
const removeSessionResources = vi.fn();
const remove = vi.fn();
const docker = { getContainer: vi.fn(() => ({ remove })) };

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/sessions/reconcile', () => ({ listOrphans }));
vi.mock('@/sessions/delete-session', () => ({ removeSessionResources }));
vi.mock('@/sessions/session-deps', () => ({ sharedSessionDeps: () => ({ docker }) }));

const { removeOrphanAction } = await import('@/sessions/orphan-actions');

const CONTAINER = 'a'.repeat(64);
const SESSION = '11111111-2222-4333-8444-555555555555';
const orphan = { containerId: CONTAINER, name: 'claudecloud-session-1111', sessionId: SESSION, state: 'exited' };

beforeEach(() => {
  vi.clearAllMocks();
  listOrphans.mockResolvedValue([orphan]);
  removeSessionResources.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

describe('removeOrphanAction', () => {
  it('checks the owner before anything else', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(removeOrphanAction(CONTAINER)).rejects.toThrow('403');
    expect(listOrphans).not.toHaveBeenCalled();
  });

  it('rejects a malformed container id without asking Docker', async () => {
    for (const bad of [undefined, 42, '', 'abc', '../x', `${CONTAINER}0`, 'z'.repeat(64)]) {
      expect(await removeOrphanAction(bad)).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(listOrphans).not.toHaveBeenCalled();
  });

  it('removes an orphan with its session docker volume, like a deleted session', async () => {
    expect(await removeOrphanAction(CONTAINER)).toMatchObject({ ok: true });
    expect(removeSessionResources).toHaveBeenCalledWith(docker, CONTAINER, SESSION);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('an orphan whose label is not a session id loses only its container', async () => {
    listOrphans.mockResolvedValueOnce([{ ...orphan, sessionId: 'not-a-uuid' }]);
    expect(await removeOrphanAction(CONTAINER)).toMatchObject({ ok: true });
    expect(removeSessionResources).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ force: true, v: true });
  });

  it('refuses a container that is no longer an orphan (a live session owns it, or it is gone)', async () => {
    listOrphans.mockResolvedValueOnce([]);
    expect(await removeOrphanAction(CONTAINER)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(removeSessionResources).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('maps a Docker failure to an error result, logging the error name only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    removeSessionResources.mockRejectedValueOnce(Object.assign(new Error('conflict: busy-secret-path'), { statusCode: 409 }));
    const result = await removeOrphanAction(CONTAINER);
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('busy-secret-path');
    expect(JSON.stringify(result)).not.toContain('busy-secret-path');
    expect(revalidatePath).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('a Docker failure while listing is an error result too', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    listOrphans.mockRejectedValueOnce(new Error('connect ENOENT'));
    expect(await removeOrphanAction(CONTAINER)).toMatchObject({ ok: false, reason: 'unavailable' });
    log.mockRestore();
  });
});
