'use server';

import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import { listBranches, listRepos } from '@/github/repos';
import { assertRepoAccessible, repoAccessFailure } from '@/repos/repo-access';
import { readRepoSettings } from '@/repos/repo-settings-store';
import type { PagedOptions } from '@/ui/paged-combo-box';

const searchSchema = z.object({
  query: z.string().max(100).catch(''),
  page: z.number().int().min(1).max(10_000).catch(1),
});

export type RepoDefaults =
  | { ok: true; fullName: string; baseBranch: string; profiles: string[] }
  | { ok: false; message: string };

/** New session's repository picker: one page (20) of repositories the App can see, searched by name. */
export async function searchRepoOptions(query: unknown, page: unknown): Promise<PagedOptions> {
  await requireOwner();
  const input = searchSchema.parse({ query, page });
  try {
    const result = await listRepos({ query: input.query, page: input.page });
    return {
      ok: true,
      items: result.items.map((repo) => ({
        id: repo.fullName,
        label: repo.fullName,
        detail: `${repo.private ? 'private' : 'public'} · ${repo.defaultBranch}`,
      })),
      page: result.page,
      pageCount: result.pageCount,
    };
  } catch (error) {
    return { ok: false, message: repoAccessFailure(error) };
  }
}

/** New session's base branch picker: one page (20) of the repository's branches, searched by name. */
export async function searchBranchOptions(repo: unknown, query: unknown, page: unknown): Promise<PagedOptions> {
  await requireOwner();
  const input = searchSchema.parse({ query, page });
  try {
    const { fullName, defaultBranch } = await assertRepoAccessible(repo);
    const result = await listBranches(fullName, { query: input.query, page: input.page });
    return {
      ok: true,
      items: result.items.map((branch) => ({
        id: branch.name,
        label: branch.name,
        detail: branch.name === defaultBranch ? 'default branch' : branch.protected ? 'protected' : undefined,
      })),
      page: result.page,
      pageCount: result.pageCount,
    };
  } catch (error) {
    return { ok: false, message: repoAccessFailure(error) };
  }
}

/**
 * What New session pre-fills for a repository: its remembered base branch (else GitHub's default branch)
 * and its remembered profiles.
 */
export async function repoDefaultsAction(repo: unknown): Promise<RepoDefaults> {
  await requireOwner();
  try {
    const summary = await assertRepoAccessible(repo);
    const settings = await readRepoSettings(summary.fullName);
    return {
      ok: true,
      fullName: summary.fullName,
      baseBranch: settings.defaultBaseBranch ?? summary.defaultBranch,
      profiles: settings.defaultProfiles,
    };
  } catch (error) {
    return { ok: false, message: repoAccessFailure(error) };
  }
}
