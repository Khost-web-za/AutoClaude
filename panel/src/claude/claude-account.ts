import { credentialsVolume, type CredentialsVolume } from './credentials-volume';

export type ClaudeStatus = {
  state: 'connected' | 'expired' | 'missing';
  /** The email is not in the credentials file (spike), so this stays null until a source exists. */
  accountEmailMasked: string | null;
  plan: string | null;
  lastRefreshAt: Date | null;
  expiresAt: Date | null;
};

/** `owner@example.com` -> `o••••@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '••••';
  return `${email[0]}••••${email.slice(at)}`;
}

const REFRESH_GRACE_MS = 60 * 60 * 1000;

/** Non-secret facts only; token fields never leave this module. */
export async function claudeStatus(
  volume: Pick<CredentialsVolume, 'readCredentials' | 'credentialsMtime'> = credentialsVolume(),
  now: Date = new Date(),
): Promise<ClaudeStatus> {
  const [credentials, mtime] = await Promise.all([volume.readCredentials(), volume.credentialsMtime()]);
  if (!credentials) {
    return { state: 'missing', accountEmailMasked: null, plan: null, lastRefreshAt: null, expiresAt: null };
  }
  const { expiresAt, subscriptionType } = credentials.claudeAiOauth;
  // The runners refresh the access token in place, so a lapsed expiry only counts when the file is stale too.
  const stale = !mtime || now.getTime() - mtime.getTime() > REFRESH_GRACE_MS;
  const expired = expiresAt < now.getTime() && stale;
  return {
    state: expired ? 'expired' : 'connected',
    accountEmailMasked: null,
    plan: subscriptionType,
    lastRefreshAt: mtime,
    expiresAt: new Date(expiresAt),
  };
}
