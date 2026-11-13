import { z } from 'zod';
import { githubApp, githubInstallations } from '@/db/schema';
import { parsePrivateKey, signAppJwt } from './app-jwt';
import { MissingPermissionsError, missingPermissions } from './app-permissions';
import { githubRequest } from './github-api';
import type { GithubDeps } from './github-deps';

export class GithubAppNotConfiguredError extends Error {
  override name = 'GithubAppNotConfiguredError';
  constructor() {
    super('No GitHub App is configured');
  }
}

export type GithubAppRow = typeof githubApp.$inferSelect;

/** Secret refs: there is one app, so one ref each. */
export const APP_SECRET_REF = 'app';

export type SaveAppInput = {
  appId: number;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret?: string | null;
  ownerLogin: string;
  htmlUrl: string;
};

export async function getApp(deps: GithubDeps): Promise<GithubAppRow | null> {
  const [row] = await deps.db.select().from(githubApp).limit(1);
  return row ?? null;
}

export async function requireApp(deps: GithubDeps): Promise<GithubAppRow> {
  const app = await getApp(deps);
  if (!app) throw new GithubAppNotConfiguredError();
  return app;
}

/** The app JWT for GitHub's app-level endpoints. The key is read from the secret store per call, never kept. */
export async function appJwt(deps: GithubDeps): Promise<string> {
  const [app, privateKey] = await Promise.all([
    requireApp(deps),
    deps.secretStore.get('github_app_private_key', APP_SECRET_REF),
  ]);
  if (!privateKey) throw new GithubAppNotConfiguredError();
  return signAppJwt(app.appId, privateKey, deps.now());
}

/**
 * Persists the app. Secrets go through the secret store, the row last, so a row only exists once the
 * app is usable. Replacing a different app forgets the old one's installations and user token.
 */
export async function saveApp(input: SaveAppInput, deps: GithubDeps): Promise<void> {
  parsePrivateKey(input.privateKey);
  const previous = await getApp(deps);

  await Promise.all([
    deps.secretStore.put('github_app_private_key', APP_SECRET_REF, input.privateKey),
    deps.secretStore.put('github_app_client_secret', APP_SECRET_REF, input.clientSecret),
    input.webhookSecret
      ? deps.secretStore.put('github_app_webhook_secret', APP_SECRET_REF, input.webhookSecret)
      : deps.secretStore.remove('github_app_webhook_secret', APP_SECRET_REF),
  ]);

  const values = {
    appId: input.appId,
    slug: input.slug,
    clientId: input.clientId,
    ownerLogin: input.ownerLogin,
    htmlUrl: input.htmlUrl,
  };
  await deps.db.transaction(async (tx) => {
    if (previous && previous.appId !== input.appId) await tx.delete(githubInstallations);
    await tx
      .insert(githubApp)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: githubApp.id, set: values });
  });
  if (previous && previous.appId !== input.appId) {
    await deps.secretStore.remove('github_user_token', 'default');
  }
  deps.tokenCache.clear();
  deps.listCache.clear();
  deps.identityCache.clear();
}

/**
 * Forgets the App entirely: the row first (so nothing treats a half-removed App as usable), then its
 * installations, secrets and the user token. The App itself stays on GitHub until deleted there.
 */
export async function removeApp(deps: GithubDeps): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await tx.delete(githubApp);
    await tx.delete(githubInstallations);
  });
  await Promise.all([
    deps.secretStore.remove('github_app_private_key', APP_SECRET_REF),
    deps.secretStore.remove('github_app_client_secret', APP_SECRET_REF),
    deps.secretStore.remove('github_app_webhook_secret', APP_SECRET_REF),
    deps.secretStore.remove('github_user_token', 'default'),
  ]);
  deps.tokenCache.clear();
  deps.listCache.clear();
  deps.identityCache.clear();
}

const appResponse = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  html_url: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  permissions: z.record(z.string(), z.string()).default({}),
});

/**
 * "Use an existing App": proves the key and id with GET /app before anything is stored, and refuses an
 * App without the permissions sessions need (e.g. one made for deploys, which cannot push).
 */
export async function saveExistingApp(
  input: { appId: number; slug: string; clientId: string; clientSecret: string; privateKey: string },
  deps: GithubDeps,
): Promise<void> {
  const jwt = await signAppJwt(input.appId, input.privateKey, deps.now());
  const { json } = await githubRequest(deps.apiUrl, '/app', { token: jwt });
  const app = appResponse.parse(json);
  if (app.id !== input.appId) throw new Error('GitHub reports a different App id for this key');
  const missing = missingPermissions(app.permissions);
  if (missing.length > 0) throw new MissingPermissionsError(missing);
  await saveApp(
    {
      appId: app.id,
      slug: app.slug,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      privateKey: input.privateKey,
      ownerLogin: app.owner.login,
      htmlUrl: app.html_url,
    },
    deps,
  );
}

export async function getClientSecret(deps: GithubDeps): Promise<string> {
  const secret = await deps.secretStore.get('github_app_client_secret', APP_SECRET_REF);
  if (!secret) throw new GithubAppNotConfiguredError();
  return secret;
}
