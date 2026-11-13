import { describe, expect, it } from 'vitest';
import { githubApp, githubInstallations, secrets } from '@/db/schema';
import { beginManifestFlow, completeManifest } from '@/github/app-manifest';
import { GITHUB_APP_PERMISSIONS, MissingPermissionsError } from '@/github/app-permissions';
import { getApp, removeApp, saveExistingApp } from '@/github/app-store';
import { handleManifestCallback, handleManifestStart, handleSetupCallback } from '@/github/callback-handlers';
import { listInstallations, recordInstallation, syncInstallations } from '@/github/installations';
import { NextRequest } from 'next/server';
import { PUBLIC_URL, seedApp, seedInstallation, withGithub, type GithubCtx } from './github-fixtures';
import { verifyAppJwt } from './github-stub';

const conversion = (ctx: GithubCtx) => ({
  status: 201,
  json: {
    id: 4242,
    slug: 'claudecloud-test',
    client_id: 'Iv1.client',
    client_secret: 'conv-client-secret',
    webhook_secret: 'conv-webhook-secret',
    pem: ctx.keys.privatePem,
    html_url: 'https://github.com/apps/claudecloud-test',
    owner: { login: 'octocat' },
  },
});

function callbackRequest(path: string, query: Record<string, string>, cookie?: { name: string; value: string }) {
  const url = new URL(path, PUBLIC_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {} });
}

async function stored(ctx: GithubCtx) {
  const [apps, rows] = await Promise.all([
    ctx.deps.db.select().from(githubApp),
    ctx.deps.db.select({ kind: secrets.kind, ref: secrets.ref }).from(secrets),
  ]);
  return { apps, secretKinds: rows.map((r) => r.kind).sort() };
}

describe('manifest flow', () => {
  it('beginManifestFlow returns the github.com form target, the manifest and a state cookie', async () => {
    await withGithub(async (ctx) => {
      const flow = beginManifestFlow({ ownerHint: 'octocat' }, ctx.deps);
      expect(flow.postUrl.startsWith(`${ctx.stub.url}/settings/apps/new?state=`)).toBe(true);
      expect(new URL(flow.postUrl).searchParams.get('state')).toBe(flow.state);
      // GitHub requires hook_attributes.url even with the webhook off; without it: '"url" wasn't supplied'.
      expect(JSON.parse(flow.manifest)).toMatchObject({
        url: PUBLIC_URL,
        hook_attributes: { url: `${PUBLIC_URL}/api/github/webhook`, active: false },
      });
      expect(flow.cookie.options.httpOnly).toBe(true);

      const org = beginManifestFlow({ ownerHint: 'k', organization: 'my-org' }, ctx.deps);
      expect(org.postUrl).toContain('/organizations/my-org/settings/apps/new?state=');
      expect(() => beginManifestFlow({ ownerHint: 'k', organization: '../evil' }, ctx.deps)).toThrow();
    });
  });

  it('stores the app row and the three secrets through the secret store and returns none of them', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('POST /app-manifests/abc123/conversions', conversion(ctx));
      const { state, cookie } = beginManifestFlow({ ownerHint: 'octocat' }, ctx.deps);

      await expect(
        completeManifest({ code: 'abc123', state, stateCookie: cookie.value }, ctx.deps),
      ).resolves.toBeUndefined();

      const { apps, secretKinds } = await stored(ctx);
      expect(apps).toHaveLength(1);
      expect(apps[0]).toMatchObject({ appId: 4242, slug: 'claudecloud-test', clientId: 'Iv1.client', ownerLogin: 'octocat' });
      expect(JSON.stringify(apps[0])).not.toMatch(/conv-|BEGIN/);
      expect(secretKinds).toEqual(['github_app_client_secret', 'github_app_private_key', 'github_app_webhook_secret']);
      expect(await ctx.secrets.get('github_app_client_secret', 'app')).toBe('conv-client-secret');
      expect(await ctx.secrets.get('github_app_private_key', 'app')).toBe(ctx.keys.privatePem);
    });
  });

  it('rejects a bad state before calling GitHub or storing anything', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('POST /app-manifests/abc123/conversions', conversion(ctx));
      const { cookie } = beginManifestFlow({ ownerHint: 'octocat' }, ctx.deps);

      const response = await handleManifestCallback(
        callbackRequest('/api/github/manifest/callback', { code: 'abc123', state: 'forged' }, cookie),
        ctx.deps,
      );
      expect(response.status).toBe(400);
      expect(ctx.stub.requests).toHaveLength(0);
      expect(await stored(ctx)).toEqual({ apps: [], secretKinds: [] });

      const noCookie = await handleManifestCallback(
        callbackRequest('/api/github/manifest/callback', { code: 'abc123', state: 'forged' }),
        ctx.deps,
      );
      expect(noCookie.status).toBe(400);
    });
  });

  it('a valid callback redirects to the connections page, clears the cookie, and cannot be replayed', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('POST /app-manifests/abc123/conversions', conversion(ctx));
      const { state, cookie } = beginManifestFlow({ ownerHint: 'octocat' }, ctx.deps);
      const request = () => callbackRequest('/api/github/manifest/callback', { code: 'abc123', state }, cookie);

      const ok = await handleManifestCallback(request(), ctx.deps);
      expect(ok.status).toBe(303);
      expect(ok.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?connected=1`);
      expect(ok.headers.get('set-cookie')).toContain(`${cookie.name}=;`);

      const replay = await handleManifestCallback(request(), ctx.deps);
      expect(replay.status).toBe(400);
      expect(ctx.stub.count('POST /app-manifests/abc123/conversions')).toBe(1);
    });
  });

  it('the copyable start link answers a self-submitting form and a state cookie that completes the callback', async () => {
    await withGithub(async (ctx) => {
      const response = handleManifestStart({ organization: 'my-org', ownerHint: 'k' }, ctx.deps);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      const action = /action="([^"]+)"/.exec(html)?.[1]?.replaceAll('&#38;', '&') ?? '';
      expect(action).toContain(`${ctx.stub.url}/organizations/my-org/settings/apps/new?state=`);
      // The manifest JSON is attribute-escaped, never raw quotes inside value="…".
      const value = /name="manifest" value="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(value).toContain('&#34;hook_attributes&#34;');

      const [pair] = (response.headers.get('set-cookie') ?? '').split(';');
      const [name, cookieValue] = (pair ?? '').split('=');
      ctx.stub.on('POST /app-manifests/abc123/conversions', conversion(ctx));
      const done = await handleManifestCallback(
        callbackRequest(
          '/api/github/manifest/callback',
          { code: 'abc123', state: new URL(action).searchParams.get('state') ?? '' },
          { name: name!, value: cookieValue! },
        ),
        ctx.deps,
      );
      expect(done.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?connected=1`);

      expect(handleManifestStart({ organization: '../evil', ownerHint: 'k' }, ctx.deps).status).toBe(400);
    });
  });

  it('refuses a malformed conversion response without storing a partial app', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('POST /app-manifests/abc123/conversions', { status: 201, json: { id: 1, slug: 'x' } });
      const { state, cookie } = beginManifestFlow({ ownerHint: 'octocat' }, ctx.deps);
      await expect(completeManifest({ code: 'abc123', state, stateCookie: cookie.value }, ctx.deps)).rejects.toThrow();
      expect(await stored(ctx)).toEqual({ apps: [], secretKinds: [] });
    });
  });
});

const existingApp = { id: 77, slug: 'mine', html_url: 'https://github.com/apps/mine', owner: { login: 'octocat' } };

describe('use an existing app', () => {
  it('verifies the key against GET /app with a signed JWT and stores the secrets', async () => {
    await withGithub(async (ctx) => {
      let claims: Record<string, unknown> = {};
      ctx.stub.on('GET /app', async (req) => {
        claims = (await verifyAppJwt(ctx.keys, req.headers.authorization)).payload;
        return { json: { ...existingApp, permissions: { ...GITHUB_APP_PERMISSIONS, issues: 'read' } } };
      });
      await saveExistingApp(
        { appId: 77, slug: 'mine', clientId: 'Iv1.x', clientSecret: 'cs', privateKey: ctx.keys.privatePem },
        ctx.deps,
      );
      expect(claims.iss).toBe('77');
      expect(await getApp(ctx.deps)).toMatchObject({ appId: 77, slug: 'mine', ownerLogin: 'octocat' });
      expect(await ctx.secrets.get('github_app_private_key', 'app')).toBe(ctx.keys.privatePem);
    });
  });

  it('refuses an App without the permissions sessions need (e.g. a deploy App), storing nothing', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('GET /app', {
        json: { ...existingApp, permissions: { contents: 'read', metadata: 'read', pull_requests: 'write' } },
      });
      const error = await saveExistingApp(
        { appId: 77, slug: 'mine', clientId: 'Iv1.x', clientSecret: 'cs', privateKey: ctx.keys.privatePem },
        ctx.deps,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MissingPermissionsError);
      expect((error as MissingPermissionsError).missing).toEqual(['contents: write', 'workflows: write']);
      expect(await stored(ctx)).toEqual({ apps: [], secretKinds: [] });
    });
  });

  it('rejects a key GitHub does not accept and a garbage key, storing nothing', async () => {
    await withGithub(async (ctx) => {
      ctx.stub.on('GET /app', { status: 401, json: { message: 'bad jwt' } });
      const input = { appId: 77, slug: 'mine', clientId: 'x', clientSecret: 'cs' };
      await expect(saveExistingApp({ ...input, privateKey: ctx.keys.privatePem }, ctx.deps)).rejects.toThrow();
      await expect(saveExistingApp({ ...input, privateKey: 'not a key' }, ctx.deps)).rejects.toThrow();
      expect(await stored(ctx)).toEqual({ apps: [], secretKinds: [] });
    });
  });
});

describe('removeApp', () => {
  it('forgets the app, its installations, its secrets and the user token', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      await ctx.secrets.put('github_user_token', 'default', '{}');
      await ctx.secrets.put('repo', 'acme/widgets:API_KEY', 'kept');
      await removeApp(ctx.deps);
      expect(await getApp(ctx.deps)).toBeNull();
      expect(await listInstallations(ctx.deps)).toEqual([]);
      expect((await stored(ctx)).secretKinds).toEqual(['repo']);
    });
  });
});

describe('installations', () => {
  it('recordInstallation reads the account from GitHub with the app JWT instead of trusting the query', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      ctx.stub.on('GET /app/installations/99', async (req) => {
        await verifyAppJwt(ctx.keys, req.headers.authorization);
        return {
          json: { id: 99, account: { login: 'Acme', type: 'Organization' }, permissions: { contents: 'read' } },
        };
      });
      await recordInstallation(99, ctx.deps);
      expect(await listInstallations(ctx.deps)).toMatchObject([
        { installationId: 99, accountLogin: 'Acme', accountType: 'Organization', permissions: { contents: 'read' } },
      ]);
      await expect(recordInstallation(100, ctx.deps)).rejects.toThrow();
    });
  });

  it('syncInstallations upserts what GitHub lists, follows pages and drops removed installations', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'gone');
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, account: { login: `u${i}`, type: 'User' } }));
      ctx.stub.on('GET /app/installations', (req) => {
        const page = req.query.get('page') ?? '1';
        return page === '1'
          ? { json: page1, headers: { link: `<${ctx.stub.url}/app/installations?per_page=100&page=2>; rel="next", <${ctx.stub.url}/app/installations?per_page=100&page=2>; rel="last"` } }
          : { json: [{ id: 5, account: { login: 'last', type: 'Organization' }, permissions: { workflows: 'write' } }] };
      });
      await syncInstallations(ctx.deps);
      const all = await listInstallations(ctx.deps);
      expect(all).toHaveLength(101);
      expect(all.some((i) => i.accountLogin === 'gone')).toBe(false);
      expect(all.find((i) => i.installationId === 5)).toMatchObject({
        accountType: 'Organization',
        permissions: { workflows: 'write' },
      });
      expect((await ctx.deps.db.select().from(githubInstallations)).length).toBe(101);
    });
  });
});

describe('setup callback', () => {
  it('records a verified installation and redirects; rejects a non-numeric installation_id', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      ctx.stub.on('GET /app/installations/55', { json: { id: 55, account: { login: 'octocat', type: 'User' } } });
      const ok = await handleSetupCallback(
        callbackRequest('/api/github/setup', { installation_id: '55', setup_action: 'install' }),
        ctx.deps,
      );
      expect(ok.status).toBe(303);
      expect(ok.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?installed=1`);
      expect(await listInstallations(ctx.deps)).toHaveLength(1);

      const bad = await handleSetupCallback(
        callbackRequest('/api/github/setup', { installation_id: '5; drop' }),
        ctx.deps,
      );
      expect(bad.status).toBe(400);
    });
  });
});
