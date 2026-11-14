import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CatalogModule from '@/profiles/profile-catalog';
import type * as RepoAccessModule from '@/repos/repo-access';
import type * as DeleteModule from '@/sessions/delete-session';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const startSession = vi.fn();
const restartSession = vi.fn();
const stopSession = vi.fn();
const deleteSession = vi.fn();
const refreshGitState = vi.fn();
const assertRepoAccessible = vi.fn();
const listProfiles = vi.fn();
const readRepoSettings = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/env/panel-env', () => ({ getPanelEnv: () => ({ configsDir: '/configs' }) }));
vi.mock('@/sessions/start-session', () => ({ startSession, restartSession }));
vi.mock('@/sessions/stop-session', () => ({ stopSession }));
vi.mock('@/sessions/delete-session', async (importOriginal) => ({
  ...(await importOriginal<typeof DeleteModule>()),
  deleteSession,
}));
vi.mock('@/sessions/git-state', () => ({ refreshGitState }));
vi.mock('@/repos/repo-access', async (importOriginal) => ({
  ...(await importOriginal<typeof RepoAccessModule>()),
  assertRepoAccessible,
}));
vi.mock('@/repos/repo-settings-store', () => ({ readRepoSettings }));
vi.mock('@/profiles/profile-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof CatalogModule>()),
  listProfiles,
}));

const { BranchBusyError, CapacityError, InsufficientDiskError, SysboxMissingError } = await import('@/sessions/capacity');
const { DeleteNeedsConfirmationError } = await import('@/sessions/delete-session');
const { SessionNotFoundError } = await import('@/sessions/session-record');
const { StackDiscoveryError } = await import('@/docker/self-discovery');
const { deleteSessionAction, restartSessionAction, startSessionAction, stopSessionAction } = await import(
  '@/sessions/session-actions'
);

const SESSION_ID = '0b5c2a3e-1f2d-4c5b-8a9e-0123456789ab';
const dirty = { unpushedCommits: 4, uncommittedFiles: 2, prUrl: null, checkedAt: '2026-11-13T12:00:00.000Z' };
const request = { repoFullName: 'acme/widgets', baseBranch: 'main', profiles: ['frontend'], startingTask: 'Fix it' };

const profile = (name: string) => ({ name, description: null, hasClaudeMd: true, skills: [], agents: [], locked: name === 'base' });

beforeEach(() => {
  vi.clearAllMocks();
  assertRepoAccessible.mockResolvedValue({ fullName: 'Acme/Widgets', private: true, defaultBranch: 'main', pushedAt: null });
  listProfiles.mockResolvedValue({ profiles: ['base', 'frontend'].map(profile), warnings: [] });
  readRepoSettings.mockResolvedValue({ defaultBaseBranch: null, defaultProfiles: [], deliveryMode: 'pull_request' });
  startSession.mockResolvedValue({ sessionId: SESSION_ID });
});

describe('startSessionAction', () => {
  it('checks the owner before anything else', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(startSessionAction(request)).rejects.toThrow('403');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('starts with the canonical repository name and answers with the session id', async () => {
    expect(await startSessionAction(request)).toEqual({ ok: true, sessionId: SESSION_ID });
    expect(startSession).toHaveBeenCalledWith({ ...request, repoFullName: 'Acme/Widgets', deliveryMode: 'pull_request' });
    expect(readRepoSettings).toHaveBeenCalledWith('Acme/Widgets');
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('maps BranchBusyError to reason blocked with its message', async () => {
    const busy = new BranchBusyError('main', SESSION_ID);
    startSession.mockRejectedValueOnce(busy);
    expect(await startSessionAction(request)).toEqual({ ok: false, reason: 'blocked', message: busy.message });
  });

  it('maps CapacityError to reason capacity', async () => {
    startSession.mockRejectedValueOnce(new CapacityError(3));
    expect(await startSessionAction(request)).toMatchObject({ ok: false, reason: 'capacity', message: expect.any(String) });
  });

  it('maps the other refusals to their own reasons', async () => {
    startSession.mockRejectedValueOnce(new SysboxMissingError());
    expect(await startSessionAction(request)).toMatchObject({ ok: false, reason: 'sysbox' });
    startSession.mockRejectedValueOnce(new InsufficientDiskError(4, 10));
    expect(await startSessionAction(request)).toMatchObject({ ok: false, reason: 'disk' });
  });

  it('a config profiles read failure is its own error, logged by name, not a GitHub failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    listProfiles.mockRejectedValueOnce(Object.assign(new Error('EACCES /app/configs/private'), { name: 'ProfilesReadError' }));
    const result = await startSessionAction(request);
    expect(result).toMatchObject({ ok: false, reason: 'unavailable', message: expect.stringMatching(/config profiles/i) });
    expect(result).not.toMatchObject({ message: expect.stringMatching(/github/i) });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('config profiles'), 'ProfilesReadError');
    expect(JSON.stringify(log.mock.calls)).not.toContain('/app/configs/private');
    expect(assertRepoAccessible).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('a GitHub outage during validation is reported as a GitHub failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertRepoAccessible.mockRejectedValueOnce(new Error('fetch failed'));
    expect(await startSessionAction(request)).toMatchObject({ ok: false, reason: 'unavailable', message: expect.stringMatching(/github/i) });
    expect(startSession).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects an invalid request with field errors and does not start', async () => {
    const result = await startSessionAction({ ...request, startingTask: 'x'.repeat(8001) });
    expect(result).toMatchObject({ ok: false, reason: 'invalid', fieldErrors: { startingTask: [expect.any(String)] } });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('an unexpected failure is logged by name only and answered as unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    startSession.mockRejectedValueOnce(new Error('connect ECONNREFUSED secret-host'));
    const result = await startSessionAction(request);
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-host');
    expect(JSON.stringify(result)).not.toContain('secret-host');
    log.mockRestore();
  });
});

describe('deleteSessionAction', () => {
  it('without a typed name on a dirty workspace answers needsConfirmation with the git state', async () => {
    deleteSession.mockRejectedValueOnce(new DeleteNeedsConfirmationError(dirty));
    const result = await deleteSessionAction(SESSION_ID);
    expect(result).toMatchObject({ ok: false, reason: 'needs-confirmation', needsConfirmation: true, gitState: dirty });
    expect(deleteSession).toHaveBeenCalledWith(SESSION_ID, { typedRepoName: undefined });
  });

  it('passes the typed repository name through and succeeds', async () => {
    deleteSession.mockResolvedValueOnce(undefined);
    expect(await deleteSessionAction(SESSION_ID, 'Acme/Widgets')).toMatchObject({ ok: true });
    expect(deleteSession).toHaveBeenCalledWith(SESSION_ID, { typedRepoName: 'Acme/Widgets' });
  });

  it('rejects a malformed id without touching the session', async () => {
    expect(await deleteSessionAction('../etc')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('checks the owner first', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(deleteSessionAction(SESSION_ID)).rejects.toThrow('403');
    expect(deleteSession).not.toHaveBeenCalled();
  });
});

describe('stop and restart', () => {
  it('stop answers ok, and not-found for an unknown session', async () => {
    stopSession.mockResolvedValueOnce(undefined);
    expect(await stopSessionAction(SESSION_ID)).toMatchObject({ ok: true });
    stopSession.mockRejectedValueOnce(new SessionNotFoundError(SESSION_ID));
    expect(await stopSessionAction(SESSION_ID)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('restart maps CapacityError to reason capacity', async () => {
    restartSession.mockRejectedValueOnce(new CapacityError(3));
    expect(await restartSessionAction(SESSION_ID)).toMatchObject({ ok: false, reason: 'capacity' });
  });

  it('surfaces the session network guard as blocked, with its actionable message', async () => {
    const refusal = new StackDiscoveryError('Refusing to put sessions on network "uuid": it also holds docker-proxy.');
    restartSession.mockRejectedValueOnce(refusal);
    expect(await restartSessionAction(SESSION_ID)).toEqual({ ok: false, reason: 'blocked', message: refusal.message });
  });
});
