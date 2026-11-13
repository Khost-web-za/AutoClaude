import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { BASE_PROFILE, PROFILE_NAME_PATTERN, profileRootProblem, walkProfileFiles } from '@/profiles/profile-catalog';
import { UnknownProfileError } from './merge-plan';

export { planMerge, UnknownProfileError, type MergeClash } from './merge-plan';

/** relative path (posix) -> file bytes */
export type MergedConfig = Map<string, Buffer>;

export class UnsafeProfileError extends Error {
  constructor(
    public readonly profileName: string,
    reason: string,
  ) {
    super(`Config profile ${profileName} is not usable: ${reason}`);
    this.name = 'UnsafeProfileError';
  }
}

export type MergeResult = { config: MergedConfig; warnings: string[] };

/** Later profiles override earlier ones for identical skill/agent files. Bytes are never decoded. */
export async function buildMergedConfig(configsDir: string, order: string[]): Promise<MergeResult> {
  for (const name of order) {
    if (!PROFILE_NAME_PATTERN.test(name)) throw new UnknownProfileError(name);
  }
  const merged: MergedConfig = new Map();
  const warnings: string[] = [];
  const claudeParts: Buffer[] = [];

  for (const name of order) {
    const problem = await profileRootProblem(configsDir, name);
    if (problem === 'missing or unreadable') throw new UnknownProfileError(name);
    if (problem) throw new UnsafeProfileError(name, problem);
    const dir = path.join(await realpath(configsDir), name);
    let files: string[];
    try {
      files = await walkProfileFiles(dir, name, warnings);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new UnknownProfileError(name);
      throw error;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      if (file === 'CLAUDE.md') {
        const body = await readFile(full);
        claudeParts.push(Buffer.concat([Buffer.from(`# Profile: ${name}\n\n`), body]));
      } else if (file.startsWith('skills/') || file.startsWith('agents/')) {
        merged.set(file, await readFile(full));
      } else if (file === 'settings.json' && name === BASE_PROFILE) {
        merged.set(file, await readFile(full));
      }
    }
  }

  if (claudeParts.length > 0) {
    const separator = Buffer.from('\n');
    const joined: Buffer[] = [];
    for (const part of claudeParts) {
      if (joined.length > 0) joined.push(separator);
      joined.push(part);
      if (part[part.length - 1] !== 0x0a) joined.push(separator);
    }
    merged.set('CLAUDE.md', Buffer.concat(joined));
  }
  return { config: merged, warnings: warnings.sort() };
}
