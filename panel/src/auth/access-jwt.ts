import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { PanelEnv } from '@/env/panel-env';

export type AccessVerification =
  | { ok: true; email: string; expiresAt: Date }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'wrong-audience' | 'not-allowed' };

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

type AccessEnv = Pick<
  PanelEnv,
  'allowedEmail' | 'cfAccessTeamDomain' | 'cfAccessAud' | 'cfAccessJwksUrl'
>;

let testJwks: JWTVerifyGetKey | null = null;
let remoteJwks: { url: string; keys: JWTVerifyGetKey } | null = null;

/** Test hook: verify against a local JWKS instead of fetching Cloudflare's. */
export function setJwksForTests(jwks: JWTVerifyGetKey | null): void {
  testJwks = jwks;
}

function jwksFor(env: AccessEnv): JWTVerifyGetKey {
  if (testJwks) return testJwks;
  const url = env.cfAccessJwksUrl ?? `https://${env.cfAccessTeamDomain}/cdn-cgi/access/certs`;
  if (remoteJwks?.url !== url) remoteJwks = { url, keys: createRemoteJWKSet(new URL(url)) };
  return remoteJwks.keys;
}

/**
 * Verifies the signature, algorithm, issuer, audience and expiry of a Cloudflare Access token,
 * then checks the email against the single allowed owner. Fails closed: every error is a
 * rejection, and the reason never contains the token.
 */
export async function verifyAccessToken(
  token: string | null,
  env: AccessEnv,
): Promise<AccessVerification> {
  if (!token || token.trim() === '') return { ok: false, reason: 'missing' };
  try {
    const { payload } = await jwtVerify(token.trim(), jwksFor(env), {
      algorithms: ['RS256'],
      issuer: `https://${env.cfAccessTeamDomain}`,
      audience: env.cfAccessAud,
      requiredClaims: ['exp'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (email === '' || email !== env.allowedEmail.trim().toLowerCase() || !payload.exp) {
      return { ok: false, reason: 'not-allowed' };
    }
    return { ok: true, email, expiresAt: new Date(payload.exp * 1000) };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
      return { ok: false, reason: 'wrong-audience' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
