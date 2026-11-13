import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReposModule from '@/github/repos';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const put = vi.fn(async () => undefined);
const remove = vi.fn(async () => undefined);
const getRepo = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/secret-store/secret-store', () => ({ secretStore: { put, remove } }));
vi.mock('@/github/github-deps', () => ({ sharedGithubDeps: () => ({}) }));
vi.mock('@/github/repos', async (importOriginal) => ({
  ...(await importOriginal<typeof ReposModule>()),
  getRepo,
}));

const { RepoNotAccessibleError } = await import('@/github/repos');
const { NoInstallationError } = await import('@/github/tokens');
const { deleteRepoSecret, setRepoSecret } = await import('@/repos/secret-actions');

const VALUE = 'sk-live-0123456789-very-secret';
const REPO = { fullName: 'Acme/Widgets', private: true, defaultBranch: 'main', pushedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  getRepo.mockResolvedValue(REPO);
});

describe('setRepoSecret', () => {
  it('checks the owner before anything else', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(setRepoSecret('acme/widgets', 'API_KEY', VALUE)).rejects.toThrow('403');
    expect(getRepo).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects an invalid key such as my-key', async () => {
    const result = await setRepoSecret('acme/widgets', 'my-key', VALUE);
    expect(result).toMatchObject({ status: 'error', fieldErrors: { key: [expect.any(String)] } });
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['1KEY', 'lower', 'A'.repeat(65), '', 'API KEY', 'API-KEY'])('rejects the key %j', async (key) => {
    expect(await setRepoSecret('acme/widgets', key, VALUE)).toMatchObject({ status: 'error' });
    expect(put).not.toHaveBeenCalled();
  });

  it('stores a multi-line value under the canonical repo name and never returns the value', async () => {
    const multiLine = `-----BEGIN KEY-----\n${VALUE}\n-----END KEY-----\n`;
    const result = await setRepoSecret('acme/widgets', '_API_KEY_2', multiLine);
    expect(result).toEqual({ status: 'success', message: 'Saved _API_KEY_2.' });
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect(put).toHaveBeenCalledWith('repo', 'Acme/Widgets:_API_KEY_2', multiLine);
    expect(revalidatePath).toHaveBeenCalledWith('/repos/Acme/Widgets/secrets');
  });

  it('never echoes the value in a rejection either', async () => {
    const results = await Promise.all([
      setRepoSecret('acme/widgets', 'my-key', VALUE),
      setRepoSecret('acme/widgets', 'OK', `${VALUE}${'x'.repeat(32 * 1024)}`),
      setRepoSecret('acme/widgets', 'OK', ''),
    ]);
    for (const result of results) {
      expect(result.status).toBe('error');
      expect(JSON.stringify(result)).not.toContain(VALUE);
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts exactly 32 KB and rejects one byte more (UTF-8 bytes, not characters)', async () => {
    expect(await setRepoSecret('acme/widgets', 'BIG', 'x'.repeat(32 * 1024))).toMatchObject({ status: 'success' });
    expect(await setRepoSecret('acme/widgets', 'BIG', 'x'.repeat(32 * 1024 + 1))).toMatchObject({
      status: 'error',
      fieldErrors: { value: [expect.any(String)] },
    });
    // 16 Ki two-byte characters plus one: 32 KB + 2 bytes.
    expect(await setRepoSecret('acme/widgets', 'BIG', 'é'.repeat(16 * 1024 + 1))).toMatchObject({ status: 'error' });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('rejects a repo the GitHub App cannot see, without touching the store', async () => {
    getRepo.mockRejectedValueOnce(new RepoNotAccessibleError('acme/private-elsewhere'));
    const result = await setRepoSecret('acme/private-elsewhere', 'API_KEY', VALUE);
    expect(result).toMatchObject({ status: 'error', message: expect.stringMatching(/cannot see/i) });
    expect(put).not.toHaveBeenCalled();

    getRepo.mockRejectedValueOnce(new NoInstallationError('stranger'));
    expect(await setRepoSecret('stranger/repo', 'API_KEY', VALUE)).toMatchObject({ status: 'error' });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a malformed repo name before asking GitHub', async () => {
    for (const repo of ['../etc', 'no-slash', 'a/b/c', 'a/..', 42 as unknown as string]) {
      expect(await setRepoSecret(repo, 'API_KEY', VALUE)).toMatchObject({ status: 'error' });
    }
    expect(getRepo).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('reports an unreachable GitHub without saving', async () => {
    getRepo.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await setRepoSecret('acme/widgets', 'API_KEY', VALUE);
    expect(result).toMatchObject({ status: 'error', message: expect.stringMatching(/GitHub/) });
    expect(put).not.toHaveBeenCalled();
  });
});

describe('store failures', () => {
  it('answer with an error (no throw, no value, error name only in the log)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    put.mockRejectedValueOnce(new Error(`connection refused while writing ${VALUE}`));
    const saved = await setRepoSecret('acme/widgets', 'API_KEY', VALUE);
    expect(saved).toMatchObject({ status: 'error', message: expect.stringMatching(/could not save/i) });
    expect(JSON.stringify(saved)).not.toContain(VALUE);

    remove.mockRejectedValueOnce(new Error('connection refused'));
    expect(await deleteRepoSecret('acme/widgets', 'API_KEY')).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/could not delete/i),
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(VALUE);
    expect(JSON.stringify(log.mock.calls)).not.toContain('connection refused');
    log.mockRestore();
  });
});

describe('deleteRepoSecret', () => {
  it('checks the owner first', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(deleteRepoSecret('acme/widgets', 'API_KEY')).rejects.toThrow('403');
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes the named secret of the canonical repo', async () => {
    expect(await deleteRepoSecret('acme/widgets', 'API_KEY')).toEqual({ status: 'success', message: 'Deleted API_KEY.' });
    expect(remove).toHaveBeenCalledWith('repo', 'Acme/Widgets:API_KEY');
    expect(revalidatePath).toHaveBeenCalledWith('/repos/Acme/Widgets/secrets');
  });

  it('rejects an invalid key and a repo the App cannot see', async () => {
    expect(await deleteRepoSecret('acme/widgets', 'my-key')).toMatchObject({ status: 'error' });
    getRepo.mockRejectedValueOnce(new RepoNotAccessibleError('acme/hidden'));
    expect(await deleteRepoSecret('acme/hidden', 'API_KEY')).toMatchObject({ status: 'error' });
    expect(remove).not.toHaveBeenCalled();
  });
});
