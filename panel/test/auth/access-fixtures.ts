import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

export const TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
export const AUDIENCE = 'aud-tag-123';
export const ALLOWED = 'owner@example.com';

type Claims = { email?: string; aud?: string; iss?: string; expiresIn?: string | number };

export type TestKeys = {
  jwks: ReturnType<typeof createLocalJWKSet>;
  sign: (claims: Claims, key?: CryptoKey) => Promise<string>;
  otherKey: CryptoKey;
};

/** Real RS256 keypair plus a local JWKS: no network, no mocks of jose. */
export async function createTestKeys(): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    otherKey: other.privateKey,
    sign: (claims, key) =>
      new SignJWT({ email: claims.email ?? ALLOWED })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setAudience(claims.aud ?? AUDIENCE)
        .setIssuer(claims.iss ?? `https://${TEAM_DOMAIN}`)
        .setIssuedAt()
        .setExpirationTime(claims.expiresIn ?? '5m')
        .sign(key ?? privateKey),
  };
}
