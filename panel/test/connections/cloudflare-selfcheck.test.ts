import { describe, expect, it, vi } from 'vitest';
import { checkAccessEnforced } from '@/connections/cloudflare-selfcheck';

const URL_ = 'https://panel.example.com';

function fetchReturning(response: () => Response | Promise<Response>) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => response()) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

describe('checkAccessEnforced', () => {
  it('reports enforced on a 403', async () => {
    expect(await checkAccessEnforced(URL_, fetchReturning(() => new Response('no', { status: 403 })))).toBe(
      'enforced',
    );
  });

  it('reports enforced on a redirect to the Access login', async () => {
    const fetch = fetchReturning(() => redirect('https://myteam.cloudflareaccess.com/cdn-cgi/access/login/panel'));
    expect(await checkAccessEnforced(URL_, fetch)).toBe('enforced');
  });

  it('reports open on a 200', async () => {
    expect(await checkAccessEnforced(URL_, fetchReturning(() => new Response('ok')))).toBe('open');
  });

  it('reports unknown on a network error', async () => {
    const fetch = fetchReturning(() => Promise.reject(new TypeError('fetch failed')));
    expect(await checkAccessEnforced(URL_, fetch)).toBe('unknown');
  });

  it('does not trust a redirect elsewhere or a lookalike host', async () => {
    expect(await checkAccessEnforced(URL_, fetchReturning(() => redirect('https://example.com/login')))).toBe('unknown');
    expect(
      await checkAccessEnforced(URL_, fetchReturning(() => redirect('https://evilcloudflareaccess.com/login'))),
    ).toBe('unknown');
    expect(await checkAccessEnforced(URL_, fetchReturning(() => new Response('x', { status: 500 })))).toBe('unknown');
  });

  it('requests the unauthenticated health route without credentials and without following redirects', async () => {
    const fetch = fetchReturning(() => new Response('no', { status: 403 }));
    await checkAccessEnforced(`${URL_}/`, fetch);
    const [url, init] = fetch.mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe('https://panel.example.com/api/health');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).has('cf-access-jwt-assertion')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
