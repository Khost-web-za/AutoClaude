import { NextResponse, type NextRequest } from 'next/server';
import { beginManifestFlow, completeManifest } from './app-manifest';
import { githubWebUrl } from './github-api';
import type { GithubDeps } from './github-deps';
import { recordInstallation } from './installations';
import { InvalidStateError, STATE_COOKIE_NAMES, type StatePurpose } from './oauth-state';
import { completeUserAuthorization, startUserAuthorization } from './user-auth';

/**
 * The bodies of the three GitHub redirect routes. The route files call requireOwner() first and pass the
 * shared deps; tests pass their own. Responses never carry a secret: only a redirect or a fixed message.
 */

const redirectTo = (deps: GithubDeps, query: string) =>
  NextResponse.redirect(new URL(`/connections/github?${query}`, deps.publicUrl), 303);

const text = (status: number, message: string) =>
  new NextResponse(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** Spent or not, the state cookie never outlives the callback. */
function clearStateCookie(response: NextResponse, purpose: StatePurpose): NextResponse {
  response.cookies.set(STATE_COOKIE_NAMES[purpose], '', { path: '/api/github', maxAge: 0, httpOnly: true });
  return response;
}

function failure(error: unknown, purpose: StatePurpose): NextResponse {
  if (error instanceof InvalidStateError) return clearStateCookie(text(400, 'Invalid or expired state'), purpose);
  console.error(`[github] ${purpose} callback failed:`, error instanceof Error ? error.name : 'error');
  return clearStateCookie(text(502, 'GitHub request failed'), purpose);
}

export async function handleManifestCallback(request: NextRequest, deps: GithubDeps): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  if (!code) return text(400, 'Missing code');
  try {
    await completeManifest(
      { code, state: params.get('state'), stateCookie: request.cookies.get(STATE_COOKIE_NAMES.manifest)?.value },
      deps,
    );
  } catch (error) {
    return failure(error, 'manifest');
  }
  return clearStateCookie(redirectTo(deps, 'connected=1'), 'manifest');
}

export async function handleOAuthCallback(request: NextRequest, deps: GithubDeps): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return clearStateCookie(redirectTo(deps, 'error=oauth_denied'), 'oauth');
  const code = params.get('code');
  if (!code) return text(400, 'Missing code');
  try {
    await completeUserAuthorization(
      { code, state: params.get('state'), stateCookie: request.cookies.get(STATE_COOKIE_NAMES.oauth)?.value },
      deps,
    );
  } catch (error) {
    return failure(error, 'oauth');
  }
  return clearStateCookie(redirectTo(deps, 'authorized=1'), 'oauth');
}

/**
 * Starts "Authorize as me" from a plain link, so it can be copied into another browser (one signed in to a
 * different GitHub account): the state cookie is set in whichever browser opens it.
 */
export async function handleOAuthStart(deps: GithubDeps): Promise<NextResponse> {
  try {
    const { url, cookie } = await startUserAuthorization(deps);
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    console.error('[github] oauth start failed:', error instanceof Error ? error.name : 'error');
    return redirectTo(deps, 'error=authorize_failed');
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Starts "Create GitHub App" from a plain link, so it can be copied into another browser (one signed in to
 * a different GitHub account). GitHub's manifest flow needs a POST, so this answers with a page that sets
 * the state cookie in that browser and holds the manifest form. It does not auto-submit: if GitHub has to
 * sign the browser in (or pick an account) first, it drops the POST body and reports `"url" wasn't
 * supplied`, so the page asks to sign in to the right account before continuing.
 */
export function handleManifestStart(
  input: { organization: string | null; ownerHint: string },
  deps: GithubDeps,
): NextResponse {
  let flow: ReturnType<typeof beginManifestFlow>;
  try {
    flow = beginManifestFlow({ ownerHint: input.ownerHint, organization: input.organization || undefined }, deps);
  } catch {
    return text(400, 'Not a GitHub organization name');
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Create GitHub App</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f0f0f;color:#e5e5e5;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box">
<form method="post" action="${escapeHtml(flow.postUrl)}" style="max-width:28rem;display:flex;flex-direction:column;gap:16px">
<input type="hidden" name="manifest" value="${escapeHtml(flow.manifest)}">
<h1 style="font-size:1.25rem;margin:0">Create the GitHub App</h1>
<p style="margin:0;line-height:1.5">First make sure this browser is signed in to github.com with the account that should own the App${input.organization ? ` (or an owner of <strong>${escapeHtml(input.organization)}</strong>)` : ''}. GitHub loses the App details if it has to sign you in on the way.</p>
<p style="margin:0"><a href="${escapeHtml(`${githubWebUrl(deps.apiUrl)}/login`)}" target="_blank" rel="noreferrer" style="color:#4ade80">Sign in to GitHub in a new tab</a>, then come back here.</p>
<button type="submit" style="min-height:44px;padding:0 20px;border:0;border-radius:12px;background:#22c55e;color:#04140a;font-weight:700;font-size:1rem;cursor:pointer;align-self:flex-start">Continue to GitHub</button>
<p style="margin:0;font-size:.875rem;color:#a3a3a3">This page is good for 10 minutes. Reload it to start over.</p>
</form>
</body></html>`;
  const response = new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
  response.cookies.set(flow.cookie.name, flow.cookie.value, flow.cookie.options);
  return response;
}

/** GitHub sends the browser here after an installation; the id is confirmed against the API, not trusted. */
export async function handleSetupCallback(request: NextRequest, deps: GithubDeps): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get('installation_id') ?? '';
  if (!/^\d{1,15}$/.test(raw)) return text(400, 'Invalid installation_id');
  try {
    await recordInstallation(Number(raw), deps);
  } catch (error) {
    console.error('[github] setup callback failed:', error instanceof Error ? error.name : 'error');
    return text(502, 'GitHub request failed');
  }
  return redirectTo(deps, 'installed=1');
}
