import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { handleOAuthCallback, handleOAuthStart } from '@/github/callback-handlers';
import { startUserAuthorization } from '@/github/user-auth';
import { githubIdentityMode } from '@/github/tokens';
import { PUBLIC_URL, seedApp, withGithub } from './github-fixtures';

const request = (query: Record<string, string>, cookie?: { name: string; value: string }) => {
  const url = new URL('/api/github/oauth/callback', PUBLIC_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {} });
};

describe('user authorization', () => {
  it('starts at the web authorize url with client id, redirect uri and a state cookie', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      const { url, cookie, state } = await startUserAuthorization(ctx.deps);
      expect(url.origin + url.pathname).toBe(`${ctx.stub.url}/login/oauth/authorize`);
      expect(url.searchParams.get('client_id')).toBe('Iv1.client');
      expect(url.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/api/github/oauth/callback`);
      expect(url.searchParams.get('state')).toBe(state);
      expect(cookie.options.httpOnly).toBe(true);
    });
  });

  it('the copyable start link redirects to GitHub and sets the state cookie in the browser that opened it', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      const response = await handleOAuthStart(ctx.deps);
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.origin + location.pathname).toBe(`${ctx.stub.url}/login/oauth/authorize`);
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie.toLowerCase()).toContain('httponly');

      // The cookie it set completes the callback (same browser, any browser).
      const [pair] = setCookie.split(';');
      const [name, value] = (pair ?? '').split('=');
      ctx.stub.on('POST /login/oauth/access_token', { json: { access_token: 'ghu_x' } });
      ctx.stub.on('GET /user', { json: { id: 5, login: 'octocat' } });
      const done = await handleOAuthCallback(
        request({ code: 'c0de', state: location.searchParams.get('state') ?? '' }, { name: name!, value: value! }),
        ctx.deps,
      );
      expect(done.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?authorized=1`);
    });
  });

  it('the start link falls back to the page with an error when no App is configured', async () => {
    await withGithub(async (ctx) => {
      const response = await handleOAuthStart(ctx.deps);
      expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?error=authorize_failed`);
    });
  });

  it('exchanges the code, stores the token encrypted and flips the identity to user', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      ctx.stub.on('POST /login/oauth/access_token', {
        json: { access_token: 'ghu_fresh', refresh_token: 'ghr_fresh', expires_in: 28_800, refresh_token_expires_in: 100 },
      });
      ctx.stub.on('GET /user', { json: { id: 5, login: 'octocat', name: 'K' } });
      const { cookie, state } = await startUserAuthorization(ctx.deps);

      const response = await handleOAuthCallback(request({ code: 'c0de', state }, cookie), ctx.deps);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?authorized=1`);
      expect(JSON.stringify([...response.headers])).not.toContain('ghu_fresh');

      expect(ctx.stub.requests[0]?.body).toEqual({
        client_id: 'Iv1.client',
        client_secret: 'client-secret-value',
        code: 'c0de',
        redirect_uri: `${PUBLIC_URL}/api/github/oauth/callback`,
      });
      expect(await githubIdentityMode(ctx.deps)).toBe('user');
      const saved = JSON.parse((await ctx.secrets.get('github_user_token', 'default')) ?? '{}') as Record<string, unknown>;
      expect(saved).toMatchObject({ accessToken: 'ghu_fresh', refreshToken: 'ghr_fresh', login: 'octocat' });
    });
  });

  it('rejects a bad state with 400 and never exchanges the code', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      const { cookie } = await startUserAuthorization(ctx.deps);
      const response = await handleOAuthCallback(request({ code: 'c0de', state: 'forged' }, cookie), ctx.deps);
      expect(response.status).toBe(400);
      expect(ctx.stub.requests).toHaveLength(0);
      expect(await githubIdentityMode(ctx.deps)).toBe('app');
    });
  });

  it('a denied authorization redirects with an error flag and stores nothing', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      const response = await handleOAuthCallback(request({ error: 'access_denied' }), ctx.deps);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/connections/github?error=oauth_denied`);
    });
  });

  it('does not store a token when the code exchange returns an error body', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      ctx.stub.on('POST /login/oauth/access_token', { json: { error: 'bad_verification_code' } });
      const { cookie, state } = await startUserAuthorization(ctx.deps);
      const response = await handleOAuthCallback(request({ code: 'x', state }, cookie), ctx.deps);
      expect(response.status).toBe(502);
      expect(await githubIdentityMode(ctx.deps)).toBe('app');
    });
  });
});
