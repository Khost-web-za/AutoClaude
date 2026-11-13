import { GithubAppNotConfiguredError } from '@/github/app-store';
import { GithubApiError } from '@/github/github-api';
import { sharedGithubDeps, type GithubDeps } from '@/github/github-deps';
import { getRepo, RepoNotAccessibleError, type RepoSummary } from '@/github/repos';
import { NoInstallationError, parseRepoFullName } from '@/github/tokens';

/**
 * The repository as the GitHub App sees it (canonical `Owner/Name` casing), from the same cached
 * installation listing `listRepos` shows. Anything else (a malformed name, an owner without an
 * installation, a repo the installation does not include) throws `RepoNotAccessibleError`, so a
 * request can never act on a repository the Repositories page would not list.
 */
export async function assertRepoAccessible(fullName: unknown, deps?: GithubDeps): Promise<RepoSummary> {
  const name = typeof fullName === 'string' ? fullName.trim() : '';
  try {
    parseRepoFullName(name);
  } catch {
    throw new RepoNotAccessibleError(name);
  }
  try {
    return await getRepo(name, deps ?? sharedGithubDeps());
  } catch (error) {
    if (error instanceof NoInstallationError) throw new RepoNotAccessibleError(name);
    throw error;
  }
}

/** A safe message for a failed `assertRepoAccessible` (or listing), without echoing what GitHub sent. */
export function repoAccessFailure(error: unknown): string {
  if (error instanceof RepoNotAccessibleError) return 'The GitHub App cannot see that repository.';
  console.error('[repos] GitHub lookup failed:', error instanceof Error ? error.name : 'error');
  if (error instanceof GithubAppNotConfiguredError) return 'No GitHub App is configured yet.';
  if (error instanceof GithubApiError) return `GitHub refused the request (${error.status}).`;
  return 'GitHub could not be reached. Try again.';
}

/** `/repos/Owner/Name`, the base of a repository's pages. */
export function repoPath(fullName: string): string {
  const { owner, name } = parseRepoFullName(fullName);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
