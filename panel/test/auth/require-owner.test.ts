import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALLOWED, AUDIENCE, createTestKeys, TEAM_DOMAIN, type TestKeys } from './access-fixtures';

let currentHeaders = new Headers();
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => currentHeaders }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
}));

const baseEnv: Record<string, string> = {
  DATABASE_URL: 'postgres://x:x@localhost:55430/x',
  PANEL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ALLOWED_EMAIL: ALLOWED,
  CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  CF_ACCESS_AUD: AUDIENCE,
  PANEL_PUBLIC_URL: 'https://claude.example.com',
};

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});
afterEach(() => vi.unstubAllEnvs());

async function load(env: Record<string, string>, token?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...baseEnv, ...env })) vi.stubEnv(key, value);
  currentHeaders = new Headers(token ? { 'cf-access-jwt-assertion': token } : {});
  const jwt = await import('@/auth/access-jwt');
  jwt.setJwksForTests(keys.jwks);
  return (await import('@/auth/require-owner')).requireOwner;
}

describe('requireOwner', () => {
  it('returns the owner for a valid token', async () => {
    const requireOwner = await load({ NODE_ENV: 'production' }, await keys.sign({ email: 'OWNER@example.com ' }));
    expect((await requireOwner()).email).toBe(ALLOWED);
  });

  it('forbids a missing token and another email', async () => {
    await expect((await load({ NODE_ENV: 'production' }))()).rejects.toThrow('403');
    const other = await keys.sign({ email: 'eve@gmail.com' });
    await expect((await load({ NODE_ENV: 'production' }, other))()).rejects.toThrow('403');
  });

  it('uses the dev bypass outside production only', async () => {
    const dev = await load({ NODE_ENV: 'development', CF_ACCESS_DEV_BYPASS_EMAIL: ALLOWED });
    expect((await dev()).email).toBe(ALLOWED);
    const prod = await load({ NODE_ENV: 'production', CF_ACCESS_DEV_BYPASS_EMAIL: ALLOWED });
    await expect(prod()).rejects.toThrow('403');
  });
});
