import { beforeAll, describe, expect, it } from 'vitest';
import { setJwksForTests, verifyAccessToken } from '@/auth/access-jwt';
import type { PanelEnv } from '@/env/panel-env';
import { ALLOWED, AUDIENCE, createTestKeys, TEAM_DOMAIN, type TestKeys } from './access-fixtures';

const env = {
  nodeEnv: 'test',
  allowedEmail: ALLOWED,
  cfAccessTeamDomain: TEAM_DOMAIN,
  cfAccessAud: AUDIENCE,
  cfAccessJwksUrl: null,
  devBypassEmail: null,
} as PanelEnv;

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
  setJwksForTests(keys.jwks);
});

describe('verifyAccessToken', () => {
  it('accepts a valid token for the allowed email', async () => {
    const result = await verifyAccessToken(await keys.sign({}), env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.email).toBe(ALLOWED);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('accepts the allowed email with different case and surrounding spaces', async () => {
    const result = await verifyAccessToken(await keys.sign({ email: 'Owner@Example.com ' }), env);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe('owner@example.com');
  });

  it('rejects another email', async () => {
    const result = await verifyAccessToken(await keys.sign({ email: 'eve@gmail.com' }), env);
    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('rejects a token without an email', async () => {
    const result = await verifyAccessToken(await keys.sign({ email: '' }), env);
    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('rejects wrong aud', async () => {
    const result = await verifyAccessToken(await keys.sign({ aud: 'other-aud' }), env);
    expect(result).toEqual({ ok: false, reason: 'wrong-audience' });
  });

  it('rejects wrong issuer', async () => {
    const result = await verifyAccessToken(await keys.sign({ iss: 'https://evil.example.com' }), env);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects expired', async () => {
    const expired = Math.floor(Date.now() / 1000) - 120;
    const result = await verifyAccessToken(await keys.sign({ expiresIn: expired }), env);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects missing header', async () => {
    expect(await verifyAccessToken(null, env)).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyAccessToken('  ', env)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a token signed by another key', async () => {
    const result = await verifyAccessToken(await keys.sign({}, keys.otherKey), env);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects garbage and alg=none tokens', async () => {
    expect(await verifyAccessToken('not-a-jwt', env)).toEqual({ ok: false, reason: 'invalid' });
    const none = `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify({ email: ALLOWED, aud: AUDIENCE }))}.`;
    expect(await verifyAccessToken(none, env)).toEqual({ ok: false, reason: 'invalid' });
  });
});
