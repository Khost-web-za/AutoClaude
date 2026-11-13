import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';

const BACKDATE_SECONDS = 60;
const LIFETIME_SECONDS = 9 * 60;

/** Accepts GitHub's PKCS#1 download as well as PKCS#8; throws on anything that is not an RSA private key. */
export function parsePrivateKey(pem: string) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('The GitHub App private key must be an RSA key');
  return key;
}

/** The short-lived RS256 JWT that authenticates as the App itself (max 10 minutes). */
export async function signAppJwt(appId: number, privateKeyPem: string, nowMs: number): Promise<string> {
  const seconds = Math.floor(nowMs / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(String(appId))
    .setIssuedAt(seconds - BACKDATE_SECONDS)
    .setExpirationTime(seconds + LIFETIME_SECONDS)
    .sign(parsePrivateKey(privateKeyPem));
}
