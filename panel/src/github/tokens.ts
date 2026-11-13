import { z } from 'zod';
import { GITHUB_APP_PERMISSIONS } from './app-manifest';
import { appJwt } from './app-store';
import { githubRequest } from './github-api';
import { sharedGithubDeps, type GithubDeps, type InstallationTokenValue } from './github-deps';
import { findInstallationForOwner } from './installations';
import { getUserToken, hasUsableUserToken, REFRESH_MARGIN_MS } from './user-auth';

const REPO_FULL_NAME = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const USER_TOKEN_FALLBACK_LIFETIME_MS = 60 * 60 * 1000;

export class NoInstallationError extends Error {
  override name = 'NoInstallationError';
  constructor(readonly owner: string) {
    super(`The GitHub App is not installed on "${owner}"`);
  }
}

export type GitCredential = { username: 'x-access-token'; password: string; expiresAt: string };

export function parseRepoFullName(fullName: string): { owner: string; name: string } {
  const match = REPO_FULL_NAME.exec(fullName);
  const [, owner, name] = match ?? [];
  if (!owner || !name || name === '.' || name === '..') throw new Error('Invalid repository name');
  return { owner, name };
}

const accessTokenResponse = z.object({ token: z.string().min(1), expires_at: z.string() });

/**
 * An installation access token, cached in memory until 5 minutes before it expires. With `repo` the
 * token is limited to that one repository and the App's four permissions; without it, read-only
 * metadata (enough to list repositories).
 */
export function installationToken(
  deps: GithubDeps,
  installationId: number,
  repo: string | null,
): Promise<InstallationTokenValue> {
  return deps.tokenCache.getOrLoad(`${installationId}|${repo ?? '*'}`, async () => {
    const { json } = await githubRequest(deps.apiUrl, `/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      token: await appJwt(deps),
      body: repo
        ? { repositories: [repo], permissions: GITHUB_APP_PERMISSIONS }
        : { permissions: { metadata: 'read' } },
    });
    const parsed = accessTokenResponse.parse(json);
    const expiresAt = Date.parse(parsed.expires_at);
    if (Number.isNaN(expiresAt)) throw new Error('GitHub returned an invalid token expiry');
    return {
      value: { token: parsed.token, expiresAt },
      validUntil: expiresAt - REFRESH_MARGIN_MS,
    };
  });
}

/**
 * The git credential for one repo. A valid user-to-server token wins (PRs open as the user); otherwise
 * an installation token scoped to the repo. Needs an installation on the owner either way.
 */
export async function mintGitCredential(
  repoFullName: string,
  deps: GithubDeps = sharedGithubDeps(),
): Promise<GitCredential> {
  const { owner, name } = parseRepoFullName(repoFullName);
  const installation = await findInstallationForOwner(owner, deps);
  if (!installation) throw new NoInstallationError(owner);

  const user = await getUserToken(deps);
  if (user) {
    return {
      username: 'x-access-token',
      password: user.token,
      expiresAt: new Date(user.expiresAt ?? deps.now() + USER_TOKEN_FALLBACK_LIFETIME_MS).toISOString(),
    };
  }
  const token = await installationToken(deps, installation.installationId, name);
  return { username: 'x-access-token', password: token.token, expiresAt: new Date(token.expiresAt).toISOString() };
}

/** Which identity PRs and commits will carry: 'user' once "Authorize as me" is done, else the App. */
export async function githubIdentityMode(deps: GithubDeps = sharedGithubDeps()): Promise<'user' | 'app'> {
  return (await hasUsableUserToken(deps)) ? 'user' : 'app';
}
