import type { Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { BASE_PROFILE, PROFILE_NAME_PATTERN } from './profile-names';

export { BASE_PROFILE, PROFILE_NAME_PATTERN };

export type Profile = {
  name: string;
  description: string | null;
  hasClaudeMd: boolean;
  skills: string[];
  agents: string[];
  locked: boolean;
};

export type ProfileCatalog = { profiles: Profile[]; warnings: string[] };

/** Only plain files and directories are ever followed; symlinks (and anything exotic) are not. */
export function isPlainEntry(stats: Pick<Stats, 'isSymbolicLink' | 'isFile' | 'isDirectory'>): boolean {
  if (stats.isSymbolicLink()) return false;
  return stats.isFile() || stats.isDirectory();
}

/** True when `target` is `root` itself or inside it. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Lists the regular files below `dir` (relative, posix separators), never following symlinks.
 * Symlinks and special entries are skipped with a warning.
 */
export type WalkFs = {
  lstat: (p: string) => Promise<Pick<Stats, 'isSymbolicLink' | 'isFile' | 'isDirectory'>>;
  readdir: (p: string) => Promise<string[]>;
};

export async function walkProfileFiles(
  dir: string,
  label: string,
  warnings: string[],
  fs: WalkFs = { lstat, readdir },
): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(current);
    for (const entry of entries.sort()) {
      const full = path.join(current, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const stats = await fs.lstat(full);
      if (!isPlainEntry(stats)) {
        warnings.push(`${label}/${relative}: skipped (symlink or special file)`);
        continue;
      }
      if (stats.isDirectory()) await walk(full, relative);
      else files.push(relative);
    }
  }
  await walk(dir, '');
  return files;
}

/** Why a profile root cannot be used, or null when it is a plain directory inside configs/. */
export type RootFs = Pick<WalkFs, 'lstat'> & { realpath: (p: string) => Promise<string> };

export async function profileRootProblem(
  configsDir: string,
  name: string,
  fs: RootFs = { lstat, realpath },
): Promise<string | null> {
  try {
    const root = await fs.realpath(configsDir);
    const dir = path.join(root, name);
    const stats = await fs.lstat(dir);
    if (stats.isSymbolicLink()) return 'symlink';
    if (!stats.isDirectory()) return 'not a directory';
    if (!isInside(root, await fs.realpath(dir))) return 'resolves outside configs';
    return null;
  } catch {
    return 'missing or unreadable';
  }
}

async function readDescription(dir: string, name: string, warnings: string[]): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, 'profile.json'), 'utf8'));
    const description = (parsed as { description?: unknown } | null)?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : null;
  } catch {
    warnings.push(`${name}/profile.json: invalid JSON, description ignored`);
    return null;
  }
}

export async function listProfiles(configsDir: string): Promise<ProfileCatalog> {
  const warnings: string[] = [];
  let root: string;
  let entries: string[];
  try {
    root = await realpath(configsDir);
    entries = (await readdir(root)).sort();
  } catch {
    return { profiles: [], warnings: ['configs directory is missing or unreadable'] };
  }

  const found = await Promise.all(
    entries.map(async (name): Promise<Profile | null> => {
      if (!PROFILE_NAME_PATTERN.test(name)) {
        warnings.push(`${name}: skipped (invalid profile name)`);
        return null;
      }
      const stats = await lstat(path.join(root, name));
      if (!stats.isDirectory() && !stats.isSymbolicLink()) return null;
      const problem = await profileRootProblem(root, name);
      if (problem) {
        warnings.push(`${name}: skipped (${problem})`);
        return null;
      }
      const dir = path.join(root, name);
      const files = await walkProfileFiles(dir, name, warnings);
      const skills = [
        ...new Set(files.filter((f) => f.startsWith('skills/') && f.split('/').length > 2).map((f) => f.split('/')[1]!)),
      ];
      const agents = files
        .filter((f) => f.startsWith('agents/') && f.split('/').length === 2 && f.endsWith('.md'))
        .map((f) => f.slice('agents/'.length, -'.md'.length));
      const hasClaudeMd = files.includes('CLAUDE.md');
      if (!hasClaudeMd && skills.length === 0 && agents.length === 0) {
        warnings.push(`${name}: skipped (no CLAUDE.md, skills or agents)`);
        return null;
      }
      return {
        name,
        description: files.includes('profile.json') ? await readDescription(dir, name, warnings) : null,
        hasClaudeMd,
        skills,
        agents,
        locked: name === BASE_PROFILE,
      };
    }),
  );
  return { profiles: found.filter((p): p is Profile => p !== null), warnings: warnings.sort() };
}
