import { describe, expect, it, vi } from 'vitest';
import { RepoNotAccessibleError } from '@/github/repos';
import type { Profile } from '@/profiles/profile-catalog';
import { STARTING_TASK_MAX, validateNewSession } from '@/sessions/new-session-schema';

const profile = (name: string): Profile => ({
  name,
  description: null,
  hasClaudeMd: true,
  skills: [],
  agents: [],
  locked: name === 'base',
});

const catalog = ['base', 'frontend', 'security'].map(profile);
const resolveRepo = vi.fn(async (fullName: string) => {
  if (fullName.toLowerCase() !== 'acme/widgets') throw new RepoNotAccessibleError(fullName);
  return { fullName: 'Acme/Widgets', private: true, defaultBranch: 'main', pushedAt: null };
});

const valid = { repoFullName: 'acme/widgets', baseBranch: 'develop', profiles: ['frontend'], startingTask: 'Fix it' };

describe('validateNewSession', () => {
  it('accepts a valid request and answers with the canonical repository name', async () => {
    const result = await validateNewSession(valid, { profiles: catalog, resolveRepo });
    expect(result).toEqual({
      ok: true,
      input: { repoFullName: 'Acme/Widgets', baseBranch: 'develop', profiles: ['frontend'], startingTask: 'Fix it' },
    });
  });

  it('an empty starting task is no task', async () => {
    const result = await validateNewSession({ ...valid, startingTask: '   ' }, { profiles: catalog, resolveRepo });
    expect(result).toMatchObject({ ok: true, input: { startingTask: null } });
  });

  it(`rejects a starting task over ${STARTING_TASK_MAX} characters`, async () => {
    expect(STARTING_TASK_MAX).toBe(8000);
    const ok = await validateNewSession({ ...valid, startingTask: 'x'.repeat(8000) }, { profiles: catalog, resolveRepo });
    expect(ok.ok).toBe(true);
    const result = await validateNewSession({ ...valid, startingTask: 'x'.repeat(8001) }, { profiles: catalog, resolveRepo });
    expect(result).toMatchObject({ ok: false, fieldErrors: { startingTask: [expect.any(String)] } });
  });

  it('rejects a profile that is not in the catalog', async () => {
    const result = await validateNewSession({ ...valid, profiles: ['frontend', 'nope'] }, { profiles: catalog, resolveRepo });
    expect(result).toMatchObject({ ok: false, fieldErrors: { profiles: [expect.any(String)] } });
  });

  it('rejects a repository the GitHub App cannot see', async () => {
    const result = await validateNewSession({ ...valid, repoFullName: 'other/thing' }, { profiles: catalog, resolveRepo });
    expect(result).toMatchObject({ ok: false, fieldErrors: { repoFullName: [expect.any(String)] } });
  });

  it('rejects a malformed request before asking GitHub', async () => {
    resolveRepo.mockClear();
    for (const raw of [null, {}, { ...valid, repoFullName: '' }, { ...valid, baseBranch: '-x' }, { ...valid, profiles: 'base' }]) {
      expect((await validateNewSession(raw, { profiles: catalog, resolveRepo })).ok).toBe(false);
    }
    expect(resolveRepo).not.toHaveBeenCalled();
  });

  it('passes a GitHub outage through as a failure, not as "not accessible"', async () => {
    const outage = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    await expect(validateNewSession(valid, { profiles: catalog, resolveRepo: outage })).rejects.toThrow('fetch failed');
  });
});
