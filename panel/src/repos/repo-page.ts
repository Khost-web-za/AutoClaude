import 'server-only';
import { notFound } from 'next/navigation';
import { RepoNotAccessibleError, type RepoSummary } from '@/github/repos';
import { assertRepoAccessible, repoAccessFailure } from './repo-access';

export type RepoRouteParams = { params: Promise<{ owner: string; name: string }> };

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** `Owner/Name` from the route segments (not yet checked against GitHub). */
export async function repoNameFromParams(params: RepoRouteParams['params']): Promise<string> {
  const { owner, name } = await params;
  return `${decode(owner)}/${decode(name)}`;
}

/**
 * The repository a tab page is about. A repo the GitHub App cannot see is a 404 (same as one that
 * does not exist); GitHub being unreachable returns a message for the page to show.
 */
export async function loadRepoForPage(
  params: RepoRouteParams['params'],
): Promise<{ ok: true; repo: RepoSummary } | { ok: false; message: string }> {
  const fullName = await repoNameFromParams(params);
  try {
    return { ok: true, repo: await assertRepoAccessible(fullName) };
  } catch (error) {
    if (error instanceof RepoNotAccessibleError) notFound();
    return { ok: false, message: repoAccessFailure(error) };
  }
}
