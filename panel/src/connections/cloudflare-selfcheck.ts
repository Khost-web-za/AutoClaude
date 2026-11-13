export type AccessEnforcement = 'enforced' | 'open' | 'unknown';

const TIMEOUT_MS = 5000;
const CACHE_MS = 5 * 60_000;
const ACCESS_LOGIN_HOST = /(^|\.)cloudflareaccess\.com$/i;

/**
 * Asks the panel's own public URL, without a Cloudflare token, whether Access stops the request.
 * Probes `/api/health` because it is the one route the panel itself never blocks: a 403 or a redirect to
 * the Access login can only come from Cloudflare, and a 200 means anyone on the internet gets through.
 * Never throws; anything inconclusive is `unknown`.
 */
export async function checkAccessEnforced(
  publicUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessEnforcement> {
  try {
    const url = new URL('/api/health', publicUrl.replace(/\/+$/, '') + '/');
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'user-agent': 'claudecloud-panel-selfcheck' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return 'enforced';
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return 'unknown';
      return ACCESS_LOGIN_HOST.test(new URL(location, url).hostname) ? 'enforced' : 'unknown';
    }
    if (response.ok) return 'open';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const globalForCheck = globalThis as typeof globalThis & {
  __accessCheck?: { url: string; at: number; value: Promise<AccessEnforcement> };
};

/** The self-check for the layout banner and the Cloudflare tab, cached for 5 minutes per URL. */
export function cachedAccessCheck(publicUrl: string, now: number = Date.now()): Promise<AccessEnforcement> {
  const hit = globalForCheck.__accessCheck;
  if (hit && hit.url === publicUrl && now - hit.at < CACHE_MS) return hit.value;
  const value = checkAccessEnforced(publicUrl);
  globalForCheck.__accessCheck = { url: publicUrl, at: now, value };
  return value;
}
