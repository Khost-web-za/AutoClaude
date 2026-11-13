export type GithubNotice = { tone: 'success' | 'warning' | 'danger'; title: string };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const ERRORS: Record<string, GithubNotice> = {
  oauth_denied: { tone: 'warning', title: 'GitHub authorization was cancelled. PRs still open as the App.' },
  authorize_failed: { tone: 'danger', title: 'Could not start the GitHub authorization. Try again.' },
};

/**
 * The outcome of a GitHub redirect (`callback-handlers.ts` sends `connected`, `installed`, `authorized` or
 * `error=oauth_denied`). Only fixed messages: nothing from the query is ever rendered.
 */
export function githubCallbackNotice(params: SearchParams): GithubNotice | null {
  if (first(params.connected) === '1') {
    return { tone: 'success', title: 'GitHub App created. Install it on an account to give it repositories.' };
  }
  if (first(params.installed) === '1') return { tone: 'success', title: 'Installation recorded.' };
  if (first(params.authorized) === '1') return { tone: 'success', title: 'Authorized. New sessions open PRs as you.' };
  const error = first(params.error);
  return error && Object.hasOwn(ERRORS, error) ? ERRORS[error]! : null;
}
