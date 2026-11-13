import { z } from 'zod';
import { getClientSecret, requireApp } from './app-store';
import { githubRequest, githubWebRequest, githubWebUrl } from './github-api';
import type { GithubDeps } from './github-deps';
import { assertState, issueState, type StateCookie } from './oauth-state';

const USER_TOKEN_REF = 'default';
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const BOT_IDENTITY_TTL_MS = 60 * 60 * 1000;

const storedToken = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  /** Epoch ms; null for a token that does not expire. */
  expiresAt: z.number().nullable(),
  refreshExpiresAt: z.number().nullable(),
  login: z.string(),
});
type StoredToken = z.infer<typeof storedToken>;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().nullish(),
  expires_in: z.number().nullish(),
  refresh_token_expires_in: z.number().nullish(),
});

async function readStored(deps: GithubDeps): Promise<StoredToken | null> {
  const raw = await deps.secretStore.get('github_user_token', USER_TOKEN_REF);
  if (!raw) return null;
  const parsed = storedToken.safeParse(safeJson(raw));
  return parsed.success ? parsed.data : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const writeStored = (deps: GithubDeps, token: StoredToken) =>
  deps.secretStore.put('github_user_token', USER_TOKEN_REF, JSON.stringify(token));

function fromResponse(json: unknown, now: number, login: string): StoredToken {
  const parsed = tokenResponse.safeParse(json);
  // GitHub answers 200 with an `error` body for a bad code or refresh token.
  if (!parsed.success) throw new Error('GitHub did not return a user token');
  const data = parsed.data;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? now + data.expires_in * 1000 : null,
    refreshExpiresAt: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : null,
    login,
  };
}

async function refresh(deps: GithubDeps, stored: StoredToken): Promise<StoredToken> {
  if (!deps.refreshing.current) {
    deps.refreshing.current = (async () => {
      const [app, clientSecret] = await Promise.all([requireApp(deps), getClientSecret(deps)]);
      const { json } = await githubWebRequest(deps.apiUrl, '/login/oauth/access_token', {
        method: 'POST',
        accept: 'application/json',
        body: {
          client_id: app.clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: stored.refreshToken,
        },
      });
      // Refresh tokens rotate: persist the new pair before anyone uses it.
      const next = fromResponse(json, deps.now(), stored.login);
      await writeStored(deps, next);
      return next;
    })().finally(() => {
      deps.refreshing.current = null;
    });
  }
  return deps.refreshing.current as Promise<StoredToken>;
}

/** A user-to-server token with more than 5 minutes left, refreshed if needed; null when there is none usable. */
export async function getUserToken(deps: GithubDeps): Promise<{ token: string; expiresAt: number | null } | null> {
  const stored = await readStored(deps);
  if (!stored) return null;
  const now = deps.now();
  if (stored.expiresAt === null || stored.expiresAt - now > REFRESH_MARGIN_MS) {
    return { token: stored.accessToken, expiresAt: stored.expiresAt };
  }
  const refreshable = stored.refreshToken && (stored.refreshExpiresAt === null || stored.refreshExpiresAt > now);
  if (!refreshable) return null;
  try {
    const next = await refresh(deps, stored);
    return { token: next.accessToken, expiresAt: next.expiresAt };
  } catch {
    return null;
  }
}

/** Cheap check for the identity notice: a stored token that is still valid or can be refreshed. No network. */
export async function hasUsableUserToken(deps: GithubDeps): Promise<boolean> {
  const stored = await readStored(deps);
  if (!stored) return false;
  const now = deps.now();
  if (stored.expiresAt === null || stored.expiresAt > now) return true;
  return Boolean(stored.refreshToken) && (stored.refreshExpiresAt === null || stored.refreshExpiresAt > now);
}

/** The GitHub authorize URL for "Authorize as me". The caller sets `cookie` on its response. */
export async function startUserAuthorization(
  deps: GithubDeps,
): Promise<{ url: URL; state: string; cookie: StateCookie }> {
  const app = await requireApp(deps);
  const { state, cookie } = issueState('oauth', deps);
  const url = new URL('/login/oauth/authorize', githubWebUrl(deps.apiUrl));
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', `${deps.publicUrl}/api/github/oauth/callback`);
  url.searchParams.set('state', state);
  return { url, state, cookie };
}

const userResponse = z.object({
  id: z.number().int(),
  login: z.string().min(1),
  name: z.string().nullish(),
});

export async function completeUserAuthorization(
  input: { code: string; state: string | null; stateCookie: string | null | undefined },
  deps: GithubDeps,
): Promise<void> {
  assertState('oauth', input.state, input.stateCookie, deps);
  const [app, clientSecret] = await Promise.all([requireApp(deps), getClientSecret(deps)]);
  const { json } = await githubWebRequest(deps.apiUrl, '/login/oauth/access_token', {
    method: 'POST',
    accept: 'application/json',
    body: {
      client_id: app.clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: `${deps.publicUrl}/api/github/oauth/callback`,
    },
  });
  const token = fromResponse(json, deps.now(), '');
  const user = userResponse.parse((await githubRequest(deps.apiUrl, '/user', { token: token.accessToken })).json);
  await writeStored(deps, { ...token, login: user.login });
}

/** The GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL pair: the user when authorized, otherwise the App's bot account. */
export async function resolveCommitIdentity(deps: GithubDeps): Promise<{ name: string; email: string }> {
  const user = await getUserToken(deps);
  if (user) {
    try {
      const { json } = await githubRequest(deps.apiUrl, '/user', { token: user.token });
      const profile = userResponse.parse(json);
      return {
        name: profile.name || profile.login,
        email: `${profile.id}+${profile.login}@users.noreply.github.com`,
      };
    } catch {
      // A rejected user token must not block a session; fall through to the App identity.
    }
  }
  const app = await requireApp(deps);
  return deps.identityCache.getOrLoad(app.slug, async () => {
    const login = `${app.slug}[bot]`;
    const { json } = await githubRequest(deps.apiUrl, `/users/${encodeURIComponent(login)}`);
    const bot = z.object({ id: z.number().int() }).parse(json);
    return {
      value: { name: login, email: `${bot.id}+${login}@users.noreply.github.com` },
      validUntil: deps.now() + BOT_IDENTITY_TTL_MS,
    };
  });
}
