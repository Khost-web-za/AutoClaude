import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfileDetail } from '@/profiles/profile-detail';

const fixtures = path.join(import.meta.dirname, '../fixtures/configs');

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'profile-detail-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('getProfileDetail', () => {
  it('returns the catalog entry plus the CLAUDE.md text', async () => {
    const detail = await getProfileDetail(fixtures, 'frontend');
    expect(detail?.profile).toMatchObject({ name: 'frontend', description: 'Frontend work', skills: ['review', 'ui-polish'] });
    expect(detail?.claudeMd?.trim()).toBe('Frontend rules.');
  });

  it('has no CLAUDE.md text for a profile without one', async () => {
    const detail = await getProfileDetail(fixtures, 'seo');
    expect(detail?.profile.skills).toEqual(['seo-brief']);
    expect(detail?.claudeMd).toBeNull();
  });

  it('is null for unknown, invalid or traversal names', async () => {
    expect(await getProfileDetail(fixtures, 'nope')).toBeNull();
    expect(await getProfileDetail(fixtures, '..')).toBeNull();
    expect(await getProfileDetail(fixtures, 'Bad Name')).toBeNull();
    expect(await getProfileDetail(fixtures, '../configs/base')).toBeNull();
  });

  it('decodes a non-UTF-8 CLAUDE.md without throwing', async () => {
    await mkdir(path.join(tmp, 'latin'));
    await writeFile(path.join(tmp, 'latin', 'CLAUDE.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const detail = await getProfileDetail(tmp, 'latin');
    expect(detail?.claudeMd).toBe('caf�');
  });

  it('never reads a CLAUDE.md that is a symlink, and says it could not be read instead of "none"', async (ctx) => {
    await mkdir(path.join(tmp, 'linked', 'skills', 'x'), { recursive: true });
    await writeFile(path.join(tmp, 'linked', 'skills', 'x', 'SKILL.md'), 'x');
    await writeFile(path.join(tmp, 'secret.txt'), 'outside');
    try {
      await symlink(path.join(tmp, 'secret.txt'), path.join(tmp, 'linked', 'CLAUDE.md'), 'file');
    } catch {
      ctx.skip();
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const detail = await getProfileDetail(tmp, 'linked');
    expect(detail).toMatchObject({ claudeMd: null, unreadable: true });
    expect(JSON.stringify(detail)).not.toContain('outside');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('linked'));
    warn.mockRestore();
  });

  it('reports a CLAUDE.md that fails to read as unreadable and logs the error name only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failingRead = Object.assign(new Error(`EACCES: permission denied, open '${fixtures}/frontend/CLAUDE.md'`), {
      code: 'EACCES',
    });
    const detail = await getProfileDetail(fixtures, 'frontend', {
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readFile: async () => {
        throw failingRead;
      },
    });
    expect(detail).toMatchObject({ profile: { name: 'frontend', hasClaudeMd: true }, claudeMd: null, unreadable: true });
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls[0]!.join(' ');
    expect(logged).toContain('frontend');
    expect(logged).toContain('EACCES');
    expect(logged).not.toContain(fixtures);
    error.mockRestore();
  });

  it('treats a CLAUDE.md swapped for a non-file after the catalog read as unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readFile = vi.fn();
    const detail = await getProfileDetail(fixtures, 'frontend', {
      lstat: async () => ({ isFile: () => false, isSymbolicLink: () => true }),
      readFile,
    });
    expect(detail).toMatchObject({ claudeMd: null, unreadable: true });
    expect(readFile).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a CLAUDE.md the catalog skipped as a symlink as unreadable (runs where real symlinks cannot be made)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readFile = vi.fn();
    const detail = await getProfileDetail(fixtures, 'seo', {
      lstat: async () => ({ isFile: () => false, isSymbolicLink: () => true }),
      readFile,
    });
    expect(detail).toMatchObject({ profile: { hasClaudeMd: false }, claudeMd: null, unreadable: true });
    expect(readFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('seo/CLAUDE.md is a symlink'));
    warn.mockRestore();
  });

  it('is not unreadable when the profile simply has no CLAUDE.md', async () => {
    expect(await getProfileDetail(fixtures, 'seo')).toMatchObject({ claudeMd: null, unreadable: false });
  });
});
