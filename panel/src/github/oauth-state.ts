import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GithubDeps } from './github-deps';

export type StatePurpose = 'manifest' | 'oauth';

export const STATE_COOKIE_NAMES: Record<StatePurpose, string> = {
  manifest: 'cc_gh_manifest',
  oauth: 'cc_gh_oauth',
};

const STATE_TTL_MS = 10 * 60 * 1000;

export class InvalidStateError extends Error {
  override name = 'InvalidStateError';
  constructor() {
    super('Invalid or expired state');
  }
}

export type StateCookie = {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string; maxAge: number };
};

const sign = (deps: GithubDeps, purpose: StatePurpose, nonce: string, expiresAt: number) => {
  const subkey = createHmac('sha256', deps.stateKey).update('claudecloud:github-state:v1').digest();
  return createHmac('sha256', subkey).update(`${purpose}.${nonce}.${expiresAt}`).digest('base64url');
};

const equal = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * A fresh single-use nonce. `state` goes to GitHub and comes back in the query; `cookie` is HttpOnly,
 * signed and bound to the purpose, so the callback proves the same browser started the flow.
 */
export function issueState(purpose: StatePurpose, deps: GithubDeps): { state: string; cookie: StateCookie } {
  const nonce = randomBytes(24).toString('base64url');
  const expiresAt = deps.now() + STATE_TTL_MS;
  return {
    state: nonce,
    cookie: {
      name: STATE_COOKIE_NAMES[purpose],
      value: `${nonce}.${expiresAt}.${sign(deps, purpose, nonce, expiresAt)}`,
      options: {
        httpOnly: true,
        secure: deps.publicUrl.startsWith('https://'),
        // Lax: GitHub returns the browser by top-level navigation, which must carry the cookie.
        sameSite: 'lax',
        path: '/api/github',
        maxAge: STATE_TTL_MS / 1000,
      },
    },
  };
}

/** True once per nonce: the query state must equal the cookie nonce, the signature and expiry must hold. */
export function verifyState(
  purpose: StatePurpose,
  state: string | null | undefined,
  cookieValue: string | null | undefined,
  deps: GithubDeps,
): boolean {
  if (!state || !cookieValue) return false;
  const [nonce, expiry, signature, ...extra] = cookieValue.split('.');
  if (!nonce || !expiry || !signature || extra.length > 0) return false;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (!equal(signature, sign(deps, purpose, nonce, expiresAt))) return false;
  const now = deps.now();
  if (expiresAt <= now || !equal(state, nonce)) return false;

  for (const [spent, until] of deps.spentStates) if (until <= now) deps.spentStates.delete(spent);
  if (deps.spentStates.has(nonce)) return false;
  deps.spentStates.set(nonce, expiresAt);
  return true;
}

export function assertState(
  purpose: StatePurpose,
  state: string | null | undefined,
  cookieValue: string | null | undefined,
  deps: GithubDeps,
): void {
  if (!verifyState(purpose, state, cookieValue, deps)) throw new InvalidStateError();
}
