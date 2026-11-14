import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReposModule from '@/github/repos';
import type * as CatalogModule from '@/profiles/profile-catalog';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const getRepo = vi.fn();
const listProfiles = vi.fn();
const saveRepoSettings = vi.fn(async () => undefined);

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/github/github-deps', () => ({ sharedGithubDeps: () => ({}) }));
vi.mock('@/env/panel-env', () => ({ getPanelEnv: () => ({ configsDir: '/configs' }) }));
vi.mock('@/github/repos', async (importOriginal) => ({
  ...(await importOriginal<typeof ReposModule>()),
  getRepo,
}));
vi.mock('@/profiles/profile-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof CatalogModule>()),
  listProfiles,
}));
vi.mock('@/repos/repo-settings-store', () => ({ saveRepoSettings }));

const { RepoNotAccessibleError } = await import('@/github/repos');
const { updateRepoSettings } = await import('@/repos/repo-settings-actions');

const profile = (name: string) => ({
  name,
  description: null,
  hasClaudeMd: true,
  skills: [],
  agents: [],
  locked: name === 'base',
});

function form(branch: string, profiles: string[], deliveryMode = 'pull_request'): FormData {
  const data = new FormData();
  data.set('defaultBaseBranch', branch);
  data.set('deliveryMode', deliveryMode);
  for (const name of profiles) data.append('profiles', name);
  data.set('$ACTION_ID_abc', '');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  getRepo.mockResolvedValue({ fullName: 'Acme/Widgets', private: true, defaultBranch: 'main', pushedAt: null });
  listProfiles.mockResolvedValue({ profiles: ['base', 'frontend', 'security', 'seo'].map(profile), warnings: [] });
});

describe('updateRepoSettings', () => {
  it('checks the owner first', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(updateRepoSettings('acme/widgets', { status: 'idle' }, form('', []))).rejects.toThrow('403');
    expect(saveRepoSettings).not.toHaveBeenCalled();
  });

  it('saves the branch and the picked profiles in catalog order, without base or duplicates', async () => {
    const result = await updateRepoSettings('acme/widgets', { status: 'idle' }, form(' develop ', ['seo', 'base', 'frontend', 'seo']));
    expect(result).toEqual({ status: 'success', message: 'Repository settings saved.' });
    expect(saveRepoSettings).toHaveBeenCalledWith('Acme/Widgets', {
      defaultBaseBranch: 'develop',
      defaultProfiles: ['frontend', 'seo'],
      deliveryMode: 'pull_request',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/repos/Acme/Widgets/settings');
  });

  it('an empty branch means "the repository default"', async () => {
    await updateRepoSettings('acme/widgets', { status: 'idle' }, form('', []));
    expect(saveRepoSettings).toHaveBeenCalledWith('Acme/Widgets', {
      defaultBaseBranch: null,
      defaultProfiles: [],
      deliveryMode: 'pull_request',
    });
  });

  it('rejects unknown profiles and malformed branch names', async () => {
    const unknown = await updateRepoSettings('acme/widgets', { status: 'idle' }, form('', ['frontend', 'nope']));
    expect(unknown).toMatchObject({ status: 'error', fieldErrors: { profiles: [expect.any(String)] } });
    for (const branch of ['-x', 'a..b', 'feat/', 'with space', 'x.lock', 'a//b', '@{u}']) {
      expect(await updateRepoSettings('acme/widgets', { status: 'idle' }, form(branch, []))).toMatchObject({
        status: 'error',
        fieldErrors: { defaultBaseBranch: [expect.any(String)] },
      });
    }
    expect(saveRepoSettings).not.toHaveBeenCalled();
  });

  it('saves the push delivery mode', async () => {
    await updateRepoSettings('acme/widgets', { status: 'idle' }, form('', [], 'push'));
    expect(saveRepoSettings).toHaveBeenCalledWith('Acme/Widgets', expect.objectContaining({ deliveryMode: 'push' }));
  });

  it('rejects an unknown delivery mode', async () => {
    expect(await updateRepoSettings('acme/widgets', { status: 'idle' }, form('', [], 'bogus'))).toMatchObject({
      status: 'error',
      fieldErrors: { deliveryMode: ['Pick pull request or push.'] },
    });
    expect(saveRepoSettings).not.toHaveBeenCalled();
  });

  it('answers a database failure with an error instead of throwing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveRepoSettings.mockRejectedValueOnce(new Error('connection refused'));
    expect(await updateRepoSettings('acme/widgets', { status: 'idle' }, form('', []))).toMatchObject({ status: 'error' });
    expect(revalidatePath).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects a repo the GitHub App cannot see', async () => {
    getRepo.mockRejectedValueOnce(new RepoNotAccessibleError('acme/hidden'));
    expect(await updateRepoSettings('acme/hidden', { status: 'idle' }, form('', []))).toMatchObject({ status: 'error' });
    expect(saveRepoSettings).not.toHaveBeenCalled();
  });
});
