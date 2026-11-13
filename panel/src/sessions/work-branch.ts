const MAX_SLUG = 30;
const FALLBACK_SLUG = 'session';

/** First 4 hex characters of the session id; used in branch, container and volume names. */
export function sessionShortId(sessionId: string): string {
  return sessionId.replace(/-/g, '').slice(0, 4).toLowerCase();
}

function slugify(task: string): string {
  const slug = task
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return slug || FALLBACK_SLUG;
}

/** `claude/<slug>-<shortId>`: slug ≤ 30 chars of `[a-z0-9-]` from the starting task, or `session`. */
export function workBranchName(task: string | null, sessionId: string): string {
  return `claude/${slugify(task ?? '')}-${sessionShortId(sessionId)}`;
}
