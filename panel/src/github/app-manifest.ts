import { z } from 'zod';
import { GITHUB_APP_PERMISSIONS } from './app-permissions';
import { saveApp } from './app-store';
import { githubRequest, githubWebUrl } from './github-api';
import type { GithubDeps } from './github-deps';
import { assertState, issueState, type StateCookie } from './oauth-state';

const APP_NAME_LIMIT = 34;
const ORG_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const MANIFEST_CODE = /^[A-Za-z0-9_-]{1,128}$/;

/** The App manifest. No webhooks: the panel never needs inbound events from GitHub. */
export function buildManifest(publicUrl: string, ownerHint: string): object {
  const base = publicUrl.replace(/\/+$/, '');
  const prefix = 'ClaudeCloud (';
  const host = new URL(base).host.slice(0, APP_NAME_LIMIT - prefix.length - 1);
  return {
    name: `${prefix}${host})`,
    url: base,
    description: `Runs Claude Code sessions for ${ownerHint}`.slice(0, 200),
    redirect_url: `${base}/api/github/manifest/callback`,
    setup_url: `${base}/api/github/setup`,
    callback_urls: [`${base}/api/github/oauth/callback`],
    request_oauth_on_install: false,
    public: false,
    // GitHub rejects hook_attributes without a url ('"url" wasn't supplied') even when inactive. Inactive
    // means GitHub never calls it; the panel has no webhook route.
    hook_attributes: { url: `${base}/api/github/webhook`, active: false },
    default_permissions: { ...GITHUB_APP_PERMISSIONS },
  };
}

/**
 * Everything the "Create GitHub App" form needs: the page POSTs `manifest` to `postUrl`. The caller (a
 * server action) must set `cookie` on its response; the callback only accepts the matching `state`.
 */
export function beginManifestFlow(
  input: { ownerHint: string; organization?: string },
  deps: GithubDeps,
): { postUrl: string; manifest: string; state: string; cookie: StateCookie } {
  const { organization } = input;
  if (organization !== undefined && !ORG_NAME.test(organization)) throw new Error('Invalid organization name');
  const { state, cookie } = issueState('manifest', deps);
  const web = githubWebUrl(deps.apiUrl);
  const path = organization ? `/organizations/${organization}/settings/apps/new` : '/settings/apps/new';
  return {
    postUrl: `${web}${path}?state=${encodeURIComponent(state)}`,
    manifest: JSON.stringify(buildManifest(deps.publicUrl, input.ownerHint)),
    state,
    cookie,
  };
}

const conversionResponse = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().nullish(),
  pem: z.string().min(1),
  html_url: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

/**
 * Finishes the manifest flow: verifies the single-use state first (nothing leaves the panel otherwise),
 * converts the one-time code, validates the response and stores the app and its secrets. Returns nothing.
 */
export async function completeManifest(
  input: { code: string; state: string | null; stateCookie: string | null | undefined },
  deps: GithubDeps,
): Promise<void> {
  assertState('manifest', input.state, input.stateCookie, deps);
  if (!MANIFEST_CODE.test(input.code)) throw new Error('Invalid manifest code');

  const { json } = await githubRequest(deps.apiUrl, `/app-manifests/${input.code}/conversions`, { method: 'POST' });
  const app = conversionResponse.parse(json);
  await saveApp(
    {
      appId: app.id,
      slug: app.slug,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      privateKey: app.pem,
      webhookSecret: app.webhook_secret ?? null,
      ownerLogin: app.owner.login,
      htmlUrl: app.html_url,
    },
    deps,
  );
}
