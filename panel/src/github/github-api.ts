const REQUEST_TIMEOUT_MS = 15_000;

export class GithubApiError extends Error {
  override name = 'GithubApiError';
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`GitHub request failed (${status})${detail ? `: ${detail}` : ''}`);
  }
}

/** The browser-facing base (OAuth, app creation). api.github.com maps to github.com; stubs and GHES keep their origin. */
export function githubWebUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  return url.hostname === 'api.github.com' ? 'https://github.com' : url.origin;
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  /** A bearer credential (app JWT, installation token or user token). Never logged or put in errors. */
  token?: string;
  body?: unknown;
  /** Overrides the default GitHub media type (the OAuth endpoints want plain JSON). */
  accept?: string;
  query?: Record<string, string | number>;
};

export type GithubResponse = { json: unknown; link: string | null };

async function send(baseUrl: string, path: string, options: RequestOptions): Promise<GithubResponse> {
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      accept: options.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'claudecloud-panel',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = (json as { message?: unknown } | null)?.message;
    throw new GithubApiError(response.status, typeof message === 'string' ? message.slice(0, 200) : '');
  }
  return { json, link: response.headers.get('link') };
}

/** A REST call against githubApiUrl. */
export const githubRequest = (apiUrl: string, path: string, options: RequestOptions = {}) =>
  send(apiUrl, path, options);

/** A call to the web host (OAuth token endpoint). Same base rule as githubWebUrl. */
export const githubWebRequest = (apiUrl: string, path: string, options: RequestOptions = {}) =>
  send(githubWebUrl(apiUrl), path, options);

const lastPageOf = (link: string | null): number => {
  const match = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link ?? '');
  return match ? Number(match[1]) : 1;
};

/**
 * Reads every page of a list endpoint (up to `maxPages` of 100): page 1 first to learn the last page
 * from the Link header, then the rest concurrently.
 */
export async function githubGetAll<T>(
  apiUrl: string,
  path: string,
  options: { token: string; extract: (json: unknown) => T[]; query?: Record<string, string | number>; maxPages?: number },
): Promise<T[]> {
  const { token, extract, query = {}, maxPages = 10 } = options;
  const fetchPage = (page: number) =>
    githubRequest(apiUrl, path, { token, query: { ...query, per_page: 100, page } });
  const first = await fetchPage(1);
  const last = Math.min(lastPageOf(first.link), maxPages);
  const rest = await Promise.all(Array.from({ length: Math.max(0, last - 1) }, (_, i) => fetchPage(i + 2)));
  return [first, ...rest].flatMap((response) => extract(response.json));
}
