import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPlainEntry, listProfiles, profileRootProblem, walkProfileFiles } from '@/profiles/profile-catalog';

const fixtures = path.join(import.meta.dirname, '../fixtures/configs');

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'profiles-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';
const canDirLink = await (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'symprobe-'));
  try {
    await symlink(dir, path.join(dir, 'l'), dirLinkType);
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();
const canSymlink = await (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'symprobe-'));
  try {
    await writeFile(path.join(dir, 'f'), 'x');
    await symlink(path.join(dir, 'f'), path.join(dir, 'l'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();

describe('listProfiles', () => {
  it('lists valid profiles, base locked, skipping bad names and empty folders', async () => {
    const { profiles, warnings } = await listProfiles(fixtures);
    expect(profiles.map((p) => p.name)).toEqual(['base', 'frontend', 'security', 'seo']);
    const base = profiles.find((p) => p.name === 'base');
    expect(base).toMatchObject({ locked: true, hasClaudeMd: true, description: null });
    const frontend = profiles.find((p) => p.name === 'frontend');
    expect(frontend).toMatchObject({
      locked: false,
      description: 'Frontend work',
      skills: ['review', 'ui-polish'],
      agents: [],
    });
    expect(profiles.find((p) => p.name === 'security')?.agents).toEqual(['auditor']);
    expect(warnings.some((w) => w.includes('Bad Name'))).toBe(true);
  });

  it('tolerates an invalid profile.json with a warning', async () => {
    await cp(path.join(fixtures, 'frontend'), path.join(tmp, 'frontend'), { recursive: true });
    await writeFile(path.join(tmp, 'frontend/profile.json'), '{not json');
    const { profiles, warnings } = await listProfiles(tmp);
    expect(profiles[0]).toMatchObject({ name: 'frontend', description: null });
    expect(warnings.some((w) => w.includes('profile.json'))).toBe(true);
  });

  it('skips uppercase, dotted, and dot-dot style names', async () => {
    for (const name of ['Upper', '.hidden', '-lead', 'a'.repeat(41)]) {
      await mkdir(path.join(tmp, name), { recursive: true });
      await writeFile(path.join(tmp, name, 'CLAUDE.md'), 'x');
    }
    const { profiles, warnings } = await listProfiles(tmp);
    expect(profiles).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it('returns nothing for a missing configs dir', async () => {
    const { profiles, warnings } = await listProfiles(path.join(tmp, 'nope'));
    expect(profiles).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it.skipIf(!canDirLink)('skips a symlinked profile folder that points outside configs/', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
    try {
      await writeFile(path.join(outside, 'CLAUDE.md'), 'evil');
      await symlink(outside, path.join(tmp, 'linked'), dirLinkType);
      const { profiles, warnings } = await listProfiles(tmp);
      expect(profiles).toEqual([]);
      expect(warnings.some((w) => w === 'linked: skipped (symlink)')).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(!canSymlink)('skips a symlinked file inside a profile and never reads through it', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
    try {
      await mkdir(path.join(tmp, 'frontend/skills/review'), { recursive: true });
      await writeFile(path.join(tmp, 'frontend/skills/review/SKILL.md'), 'ok');
      await writeFile(path.join(outside, 'secret.txt'), 'nope');
      await symlink(path.join(outside, 'secret.txt'), path.join(tmp, 'frontend/CLAUDE.md'), 'file');
      const { profiles, warnings } = await listProfiles(tmp);
      expect(profiles[0]).toMatchObject({ name: 'frontend', hasClaudeMd: false, skills: ['review'] });
      expect(warnings.some((w) => w === 'frontend/CLAUDE.md: skipped (symlink or special file)')).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('listProfiles nested symlinks and empty folders', () => {
  it('warns for an empty folder', async () => {
    const { profiles, warnings } = await listProfiles(fixtures);
    expect(profiles.map((p) => p.name)).not.toContain('empty');
    expect(warnings).toContain('empty: skipped (no CLAUDE.md, skills or agents)');
  });

  it('returns warnings in sorted order', async () => {
    const { warnings } = await listProfiles(fixtures);
    expect(warnings).toEqual([...warnings].sort());
  });

  it.skipIf(!canSymlink)('warns about a symlinked skills dir, skill folder, nested file and agent file', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
    try {
      await writeFile(path.join(outside, 'x.md'), 'outside');
      await mkdir(path.join(outside, 'skills-dir'));
      // a: skills/ itself is a symlink
      await mkdir(path.join(tmp, 'a'));
      await writeFile(path.join(tmp, 'a/CLAUDE.md'), 'a');
      await symlink(path.join(outside, 'skills-dir'), path.join(tmp, 'a/skills'), 'dir');
      // b: skills/foo is a symlink, skills/bar has a symlinked file, agents has a symlinked .md
      await mkdir(path.join(tmp, 'b/skills/bar'), { recursive: true });
      await mkdir(path.join(tmp, 'b/agents'));
      await writeFile(path.join(tmp, 'b/skills/bar/SKILL.md'), 'ok');
      await symlink(path.join(outside, 'skills-dir'), path.join(tmp, 'b/skills/foo'), 'dir');
      await symlink(path.join(outside, 'x.md'), path.join(tmp, 'b/skills/bar/link.md'), 'file');
      await symlink(path.join(outside, 'x.md'), path.join(tmp, 'b/agents/evil.md'), 'file');
      const { profiles, warnings } = await listProfiles(tmp);
      expect(profiles.find((p) => p.name === 'a')?.skills).toEqual([]);
      expect(profiles.find((p) => p.name === 'b')).toMatchObject({ skills: ['bar'], agents: [] });
      const skipped = 'skipped (symlink or special file)';
      expect(warnings).toEqual(
        expect.arrayContaining([
          `a/skills: ${skipped}`,
          `b/skills/foo: ${skipped}`,
          `b/skills/bar/link.md: ${skipped}`,
          `b/agents/evil.md: ${skipped}`,
        ]),
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('isPlainEntry (symlink guard, injected lstat results)', () => {
  const stat = (kind: 'file' | 'dir' | 'link') =>
    ({
      isSymbolicLink: () => kind === 'link',
      isFile: () => kind === 'file',
      isDirectory: () => kind === 'dir',
    }) as unknown as Stats;

  it('rejects symlinks regardless of what they point at', () => {
    expect(isPlainEntry(stat('link'))).toBe(false);
  });
  it('accepts plain files and directories only', () => {
    expect(isPlainEntry(stat('file'))).toBe(true);
    expect(isPlainEntry(stat('dir'))).toBe(true);
  });
});

describe('guards with injected fs (work without symlink permission)', () => {
  const kind = (k: 'file' | 'dir' | 'link') => ({
    isSymbolicLink: () => k === 'link',
    isFile: () => k === 'file',
    isDirectory: () => k === 'dir',
  });

  it('walkProfileFiles warns for every symlink at any depth and never descends into one', async () => {
    const tree: Record<string, { k: 'file' | 'dir' | 'link'; children?: string[] }> = {
      '/p': { k: 'dir', children: ['CLAUDE.md', 'skills', 'agents'] },
      '/p/CLAUDE.md': { k: 'file' },
      '/p/skills': { k: 'dir', children: ['foo', 'bar', 'linked'] },
      '/p/skills/foo': { k: 'dir', children: ['SKILL.md', 'x.md'] },
      '/p/skills/foo/SKILL.md': { k: 'file' },
      '/p/skills/foo/x.md': { k: 'link' },
      '/p/skills/bar': { k: 'link' },
      '/p/skills/linked': { k: 'link', children: ['should-not-be-read'] },
      '/p/agents': { k: 'link', children: ['evil.md'] },
    };
    const read: string[] = [];
    const warnings: string[] = [];
    const files = await walkProfileFiles('/p', 'p', warnings, {
      lstat: async (q) => kind(tree[q.split(path.sep).join('/')]!.k),
      readdir: async (q) => {
        read.push(q);
        return tree[q.split(path.sep).join('/')]!.children ?? [];
      },
    });
    const skipped = 'skipped (symlink or special file)';
    expect(files.sort()).toEqual(['CLAUDE.md', 'skills/foo/SKILL.md']);
    expect(warnings.sort()).toEqual([
      `p/agents: ${skipped}`,
      `p/skills/bar: ${skipped}`,
      `p/skills/foo/x.md: ${skipped}`,
      `p/skills/linked: ${skipped}`,
    ]);
    expect(read.some((r) => r.includes('linked') || r.includes('agents'))).toBe(false);
  });

  it('profileRootProblem rejects symlinked roots and roots resolving outside configs', async () => {
    const make = (k: 'file' | 'dir' | 'link', real: string) => ({
      lstat: async () => kind(k),
      realpath: async (q: string) => (q.endsWith('evil') ? real : path.resolve('/configs')),
    });
    expect(await profileRootProblem('/configs', 'evil', make('link', '/elsewhere'))).toBe('symlink');
    expect(await profileRootProblem('/configs', 'evil', make('dir', '/elsewhere'))).toBe('resolves outside configs');
    expect(await profileRootProblem('/configs', 'evil', make('file', '/configs/evil'))).toBe('not a directory');
    expect(await profileRootProblem('/configs', 'evil', make('dir', path.resolve('/configs/evil')))).toBeNull();
  });
});
