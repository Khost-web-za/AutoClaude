import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { listProfiles, type Profile } from './profile-catalog';

const MAX_CLAUDE_MD_BYTES = 256 * 1024;

export type ProfileDetail = {
  profile: Profile;
  /** CLAUDE.md as text (invalid UTF-8 replaced, cut at 256 KB); null when there is none or it could not be read. */
  claudeMd: string | null;
  truncated: boolean;
  /** A CLAUDE.md exists but was not shown: a symlink (never followed) or a read that failed. */
  unreadable: boolean;
};

export type ProfileDetailFs = {
  lstat: (p: string) => Promise<{ isFile: () => boolean; isSymbolicLink: () => boolean }>;
  readFile: (p: string) => Promise<Buffer>;
};

const errorName = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code ?? (error instanceof Error ? error.name : 'error');

/**
 * One profile for the read-only Configs detail page. Only names the catalog itself accepts resolve, so
 * invalid names, traversal and symlinked folders are null; a symlinked CLAUDE.md is never read.
 * Logs carry the profile name and an error code only, never file content or host paths.
 */
export async function getProfileDetail(
  configsDir: string,
  name: string,
  fs: ProfileDetailFs = { lstat, readFile },
): Promise<ProfileDetail | null> {
  const { profiles } = await listProfiles(configsDir);
  const profile = profiles.find((candidate) => candidate.name === name);
  if (!profile) return null;
  const none = { profile, claudeMd: null, truncated: false, unreadable: false };
  const unreadable = { ...none, unreadable: true };
  const file = path.join(configsDir, profile.name, 'CLAUDE.md');

  if (!profile.hasClaudeMd) {
    // The catalog skips a symlinked CLAUDE.md; say so instead of claiming there is none.
    const stats = await fs.lstat(file).catch(() => null);
    if (!stats?.isSymbolicLink()) return none;
    console.warn(`[configs] ${profile.name}/CLAUDE.md is a symlink; not followed`);
    return unreadable;
  }

  try {
    const stats = await fs.lstat(file);
    if (!stats.isFile()) {
      console.warn(`[configs] ${profile.name}/CLAUDE.md is no longer a plain file; not read`);
      return unreadable;
    }
    const bytes = await fs.readFile(file);
    const truncated = bytes.length > MAX_CLAUDE_MD_BYTES;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, MAX_CLAUDE_MD_BYTES));
    return { profile, claudeMd: text, truncated, unreadable: false };
  } catch (error) {
    console.error(`[configs] could not read ${profile.name}/CLAUDE.md:`, errorName(error));
    return unreadable;
  }
}
