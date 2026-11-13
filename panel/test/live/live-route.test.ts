import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
}));
const getUsage = vi.fn(async () => null);
const fetchHostStats = vi.fn(async () => null);
vi.mock('@/usage/usage-client', () => ({ getUsage }));
vi.mock('@/host/host-stats', () => ({ fetchHostStats }));

const env: Record<string, string> = {
  DATABASE_URL: 'postgres://x:x@localhost:55430/x',
  PANEL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ALLOWED_EMAIL: 'owner@example.com',
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud',
  PANEL_PUBLIC_URL: 'https://claude.example.com',
};

async function load(extra: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(key, value);
  const [route, bus] = await Promise.all([import('@/app/api/live/route'), import('@/live/event-bus')]);
  return { route, eventBus: bus.eventBus };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('GET /api/live', () => {
  it('is forbidden without an owner', async () => {
    const { route, eventBus } = await load({ NODE_ENV: 'production' });
    await expect(route.GET(new Request('http://x/api/live'))).rejects.toThrow('403');
    expect(eventBus.listenerCount()).toBe(0);
  });

  it('streams retry, published events and heartbeats, and unsubscribes on abort', async () => {
    const { route, eventBus } = await load({ NODE_ENV: 'development', CF_ACCESS_DEV_BYPASS_EMAIL: 'owner@example.com' });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const controller = new AbortController();
    const response = await route.GET(new Request('http://x/api/live', { signal: controller.signal }));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('retry: 3000\n\n');
    expect(eventBus.listenerCount()).toBe(1);

    eventBus.publish({ kind: 'host', stats: null });
    expect(decoder.decode((await reader.read()).value)).toBe('event: host\ndata: {"kind":"host","stats":null}\n\n');

    vi.advanceTimersByTime(25_000);
    expect(decoder.decode((await reader.read()).value)).toContain(': heartbeat');

    controller.abort();
    expect(eventBus.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
