import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALLOWED, AUDIENCE, createTestKeys, TEAM_DOMAIN, type TestKeys } from './access-fixtures';

const baseEnv: Record<string, string> = {
  DATABASE_URL: 'postgres://x:x@localhost:55430/x',
  PANEL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ALLOWED_EMAIL: ' Owner@Example.com',
  CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  CF_ACCESS_AUD: AUDIENCE,
  PANEL_PUBLIC_URL: 'https://claude.example.com',
};

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});
afterEach(() => vi.unstubAllEnvs());

/** getPanelEnv() memoises, so each scenario loads a fresh module graph with its own env. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...baseEnv, ...env })) vi.stubEnv(key, value);
  const jwt = await import('@/auth/access-jwt');
  jwt.setJwksForTests(keys.jwks);
  return import('@/proxy');
}

const request = (path: string, token?: string) =>
  new NextRequest(`https://claude.example.com${path}`, {
    headers: token ? { 'cf-access-jwt-assertion': token } : {},
  });

describe('proxy', () => {
  it('returns 403 without the header', async () => {
    const { proxy } = await load({ NODE_ENV: 'production' });
    const res = await proxy(request('/'));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('returns 403 for another email without echoing the token', async () => {
    const { proxy } = await load({ NODE_ENV: 'production' });
    const token = await keys.sign({ email: 'eve@gmail.com' });
    const res = await proxy(request('/', token));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(token);
  });

  it('passes with a valid token (case and whitespace insensitive email)', async () => {
    const { proxy } = await load({ NODE_ENV: 'production' });
    const res = await proxy(request('/sessions', await keys.sign({ email: 'Owner@Example.com ' })));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('honours the dev bypass outside production', async () => {
    const { proxy } = await load({ NODE_ENV: 'development', CF_ACCESS_DEV_BYPASS_EMAIL: ALLOWED });
    expect((await proxy(request('/'))).status).toBe(200);
  });

  it('ignores the dev bypass in production', async () => {
    const { proxy } = await load({ NODE_ENV: 'production', CF_ACCESS_DEV_BYPASS_EMAIL: ALLOWED });
    expect((await proxy(request('/'))).status).toBe(403);
  });

  it('fails closed on an invalid environment', async () => {
    const { proxy } = await load({ NODE_ENV: 'production', CF_ACCESS_AUD: '' });
    expect((await proxy(request('/', await keys.sign({})))).status).toBe(403);
  });

  it('matcher excludes _next, favicon and api/health', async () => {
    const { config } = await load({ NODE_ENV: 'production' });
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/sessions/1')).toBe(true);
    expect(pattern.test('/api/sessions')).toBe(true);
    expect(pattern.test('/_next/static/x.js')).toBe(false);
    expect(pattern.test('/favicon.ico')).toBe(false);
    expect(pattern.test('/api/health')).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('is reachable without a token and returns only "ok"', async () => {
    await load({ NODE_ENV: 'production' });
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
