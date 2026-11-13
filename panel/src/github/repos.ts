import { z } from 'zod';
import { paginateArray, type PageResult } from '@/db/pagination';
import { githubGetAll } from './github-api';
import { sharedGithubDeps, type GithubDeps } from './github-deps';
import { listInstallations, findInstallationForOwner } from './installations';
import { installationToken, NoInstallationError, parseRepoFullName } from './tokens';

const LIST_CACHE_MS = 60_000;

export type RepoSummary = { fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null };
export type BranchSummary = { name: string; protected: boolean };

const repoListResponse = z.object({
  repositories: z.array(
    z.object({
      full_name: z.string(),
      private: z.boolean(),
      default_branch: z.string(),
      pushed_at: z.string().nullish(),
    }),
  ),
});

const branchListResponse = z.array(z.object({ name: z.string(), protected: z.boolean().optional() }));

const matches = (query: string, value: string) => value.toLowerCase().includes(query.trim().toLowerCase());

async function reposOfInstallation(deps: GithubDeps, installationId: number): Promise<RepoSummary[]> {
  return deps.listCache.getOrLoad(`repos|${installationId}`, async () => {
    const { token } = await installationToken(deps, installationId, null);
    const repos = await githubGetAll(deps.apiUrl, '/installation/repositories', {
      token,
      extract: (json) => repoListResponse.parse(json).repositories,
    });
    const value: RepoSummary[] = repos.map((repo) => ({
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at ?? null,
    }));
    return { value, validUntil: deps.now() + LIST_CACHE_MS };
  }) as Promise<RepoSummary[]>;
}

/**
 * Repositories across every installation, newest push first. Each installation is fetched in parallel
 * (all of its pages too) and cached for 60 s; one failing installation does not hide the rest.
 */
export async function listRepos(
  { page, query }: { page: number; query: string },
  deps: GithubDeps = sharedGithubDeps(),
): Promise<PageResult<RepoSummary>> {
  const installations = await listInstallations(deps);
  const settled = await Promise.allSettled(installations.map((i) => reposOfInstallation(deps, i.installationId)));
  const repos: RepoSummary[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') repos.push(...result.value);
    else console.warn(`[github] could not list repositories for "${installations[index]?.accountLogin}"`);
  });

  const byRecentPush = (a: RepoSummary, b: RepoSummary) =>
    (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') || a.fullName.localeCompare(b.fullName);
  const filtered = repos.filter((repo) => matches(query, repo.fullName)).sort(byRecentPush);
  return paginateArray(filtered, page);
}

/** Branches of one repo (default branch first), through a token scoped to that repo. Cached 60 s. */
export async function listBranches(
  fullName: string,
  { page, query }: { page: number; query: string },
  deps: GithubDeps = sharedGithubDeps(),
): Promise<PageResult<BranchSummary>> {
  const { owner, name } = parseRepoFullName(fullName);
  const installation = await findInstallationForOwner(owner, deps);
  if (!installation) throw new NoInstallationError(owner);

  const branches = (await deps.listCache.getOrLoad(`branches|${owner.toLowerCase()}/${name.toLowerCase()}`, async () => {
    const { token } = await installationToken(deps, installation.installationId, name);
    const all = await githubGetAll(deps.apiUrl, `/repos/${owner}/${name}/branches`, {
      token,
      extract: (json) => branchListResponse.parse(json),
    });
    return {
      value: all.map((branch): BranchSummary => ({ name: branch.name, protected: branch.protected ?? false })),
      validUntil: deps.now() + LIST_CACHE_MS,
    };
  })) as BranchSummary[];

  return paginateArray(
    branches.filter((branch) => matches(query, branch.name)),
    page,
  );
}

export class RepoNotAccessibleError extends Error {
  override name = 'RepoNotAccessibleError';
  constructor(readonly fullName: string) {
    super(`The GitHub App cannot access "${fullName}"`);
  }
}

/** One repository the owner's installation can access (from the same 60 s cached listing). */
export async function getRepo(fullName: string, deps: GithubDeps = sharedGithubDeps()): Promise<RepoSummary> {
  const { owner } = parseRepoFullName(fullName);
  const installation = await findInstallationForOwner(owner, deps);
  if (!installation) throw new NoInstallationError(owner);
  const wanted = fullName.toLowerCase();
  const repos = await reposOfInstallation(deps, installation.installationId);
  const repo = repos.find((candidate) => candidate.fullName.toLowerCase() === wanted);
  if (!repo) throw new RepoNotAccessibleError(fullName);
  return repo;
}
