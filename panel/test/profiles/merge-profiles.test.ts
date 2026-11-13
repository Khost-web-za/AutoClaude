import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import tar from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProfiles } from '@/profiles/profile-catalog';
import { UnknownProfileError, UnsafeProfileError, buildMergedConfig, planMerge } from '@/profiles/merge-profiles';
import { toTarStream } from '@/profiles/profile-archive';

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

const fixtures = path.join(import.meta.dirname, '../fixtures/configs');

describe('planMerge', () => {
  it('puts base first and the rest alphabetically', async () => {
    const { profiles } = await listProfiles(fixtures);
    expect(planMerge(['seo', 'base', 'frontend'], profiles).order).toEqual(['base', 'frontend', 'seo']);
    expect(planMerge(['seo'], profiles).order).toEqual(['base', 'seo']);
  });

  it('reports skill clashes with the last profile winning', async () => {
    const { profiles } = await listProfiles(fixtures);
    const { clashes } = planMerge(['frontend', 'security'], profiles);
    expect(clashes).toEqual([{ kind: 'skill', name: 'review', winner: 'security', losers: ['frontend'] }]);
  });

  it('rejects unknown names', async () => {
    const { profiles } = await listProfiles(fixtures);
    expect(() => planMerge(['nope'], profiles)).toThrow(UnknownProfileError);
  });
});

describe('buildMergedConfig', () => {
  it('merges CLAUDE.md by profile heading, skills, agents, and base-only settings.json', async () => {
    const { config: merged } = await buildMergedConfig(fixtures, ['base', 'frontend', 'security']);
    expect(merged.get('CLAUDE.md')?.toString('utf8')).toBe(
      '# Profile: base\n\nBase rules.\n\n# Profile: frontend\n\nFrontend rules.\n\n# Profile: security\n\nSecurity rules.\n',
    );
    expect(merged.get('skills/review/SKILL.md')?.toString().trim()).toBe('security review');
    expect(merged.get('skills/ui-polish/SKILL.md')).toBeDefined();
    expect(merged.get('agents/auditor.md')).toBeDefined();
    expect(JSON.parse(merged.get('settings.json')!.toString())).toEqual({ enabledPlugins: { 'base-plugin': true } });
    expect([...merged.keys()].some((k) => k.includes('profile.json'))).toBe(false);
  });

  it('throws UnknownProfileError for unknown or traversal names', async () => {
    await expect(buildMergedConfig(fixtures, ['base', 'nope'])).rejects.toBeInstanceOf(UnknownProfileError);
    await expect(buildMergedConfig(fixtures, ['base', '..'])).rejects.toBeInstanceOf(UnknownProfileError);
  });

  describe('odd content', () => {
    let tmp: string;
    beforeEach(async () => {
      tmp = await mkdtemp(path.join(tmpdir(), 'merge-'));
    });
    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it.skipIf(!canSymlink)('skips symlinks while merging, with a warning, and never reads through them', async () => {
      const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
      try {
        await writeFile(path.join(outside, 'x.md'), 'outside');
        await mkdir(path.join(tmp, 'base/skills/foo'), { recursive: true });
        await writeFile(path.join(tmp, 'base/CLAUDE.md'), 'ok\n');
        await writeFile(path.join(tmp, 'base/skills/foo/SKILL.md'), 'ok');
        await symlink(path.join(outside, 'x.md'), path.join(tmp, 'base/skills/foo/link.md'), 'file');
        await symlink(outside, path.join(tmp, 'base/agents'), 'dir');
        const { config, warnings } = await buildMergedConfig(tmp, ['base']);
        expect([...config.keys()].sort()).toEqual(['CLAUDE.md', 'skills/foo/SKILL.md']);
        expect(warnings).toEqual([
          'base/agents: skipped (symlink or special file)',
          'base/skills/foo/link.md: skipped (symlink or special file)',
        ]);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it.skipIf(!canDirLink)('refuses a profile root that is a symlink to outside configs/', async () => {
      const outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
      try {
        await mkdir(path.join(tmp, 'base'));
        await writeFile(path.join(tmp, 'base/CLAUDE.md'), 'ok');
        await writeFile(path.join(outside, 'CLAUDE.md'), 'evil');
        await symlink(outside, path.join(tmp, 'evil'), dirLinkType);
        await expect(buildMergedConfig(tmp, ['base', 'evil'])).rejects.toBeInstanceOf(UnsafeProfileError);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it('copies a non-UTF-8 CLAUDE.md verbatim', async () => {
      const bytes = Buffer.from([0xff, 0xfe, 0x80, 0x41, 0x0a]);
      await mkdir(path.join(tmp, 'base'));
      await writeFile(path.join(tmp, 'base/CLAUDE.md'), bytes);
      const { config: merged } = await buildMergedConfig(tmp, ['base']);
      const out = merged.get('CLAUDE.md')!;
      expect(Buffer.isBuffer(out)).toBe(true);
      expect(out.subarray(out.length - bytes.length).equals(bytes)).toBe(true);
    });
  });
});

describe('toTarStream', () => {
  it('emits entries under session-config/ with owner 1000 and 0644/0755 modes', async () => {
    const merged = new Map<string, Buffer>([
      ['CLAUDE.md', Buffer.from('hi')],
      ['skills/a/SKILL.md', Buffer.from('s')],
      ['skills/a/run.sh', Buffer.from('#!/bin/sh')],
    ]);
    const extract = tar.extract();
    const seen: Record<string, { mode?: number; uid?: number; gid?: number; type: string; body: string }> = {};
    const done = new Promise<void>((resolve, reject) => {
      extract.on('entry', (header, stream, next) => {
        text(stream).then((body) => {
          seen[header.name] = { mode: header.mode, uid: header.uid, gid: header.gid, type: header.type ?? '', body };
          next();
        }, reject);
      });
      extract.on('finish', resolve);
      extract.on('error', reject);
    });
    toTarStream(merged).pipe(extract);
    await done;
    expect(seen['session-config/CLAUDE.md']).toMatchObject({ mode: 0o644, uid: 1000, gid: 1000, body: 'hi' });
    expect(seen['session-config/skills/a/run.sh']?.mode).toBe(0o755);
    expect(seen['session-config/skills/a']).toMatchObject({ type: 'directory', mode: 0o755, uid: 1000 });
    expect(seen['session-config/skills']?.type).toBe('directory');
  });
});
