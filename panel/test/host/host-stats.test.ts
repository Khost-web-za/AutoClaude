import { describe, expect, it, vi } from 'vitest';
import { createHostStatsClient, runnerTagOf, type HostStatsClientDeps } from '@/host/host-stats';

const GB = 1024 ** 3;
const body = {
  disk: { totalBytes: 500 * GB, freeBytes: 58 * GB, path: '/host/docker' },
  cpu: { pct: 21.4 },
  memory: { totalBytes: 32 * GB, availableBytes: 16 * GB },
};

function setup(overrides: Partial<HostStatsClientDeps> = {}, response: () => Response = () => Response.json(body)) {
  let now = 1_000_000;
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => response());
  const publish = vi.fn();
  const warn = vi.fn();
  const client = createHostStatsClient({
    url: 'http://hoststats:9100',
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
    publish,
    warn,
    timeoutMs: 1000,
    ...overrides,
  });
  return { client, fetchMock, publish, warn, advance: (ms: number) => (now += ms) };
}

describe('fetchHostStats', () => {
  it('returns the parsed stats from GET /stats and publishes a host event', async () => {
    const { client, fetchMock, publish } = setup();
    expect(await client.fetchHostStats()).toEqual(body);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://hoststats:9100/stats');
    expect(publish).toHaveBeenCalledWith({ kind: 'host', stats: body });
  });

  it('returns null when the request times out', async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const { client, publish, warn } = setup({ fetch: hang as unknown as typeof fetch, timeoutMs: 20 });
    expect(await client.fetchHostStats()).toBeNull();
    expect(publish).toHaveBeenCalledWith({ kind: 'host', stats: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns null for a non-200 or a malformed body', async () => {
    expect(await setup({}, () => new Response('x', { status: 500 })).client.fetchHostStats()).toBeNull();
    expect(await setup({}, () => Response.json({ disk: {} })).client.fetchHostStats()).toBeNull();
  });

  it('caches for 15 s, then refetches', async () => {
    const { client, fetchMock, advance } = setup();
    await client.fetchHostStats();
    advance(14_999);
    await client.fetchHostStats();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2);
    await client.fetchHostStats();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { client, fetchMock } = setup();
    await Promise.all([client.fetchHostStats(), client.fetchHostStats()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing publisher', async () => {
    const { client } = setup({
      publish: () => {
        throw new Error('listener broke');
      },
    });
    expect(await client.fetchHostStats()).toEqual(body);
  });
});

describe('runnerTagOf', () => {
  it('takes the tag of the image reference', () => {
    expect(runnerTagOf('claudecloud-runner:local')).toBe('local');
    expect(runnerTagOf('registry:5000/claudecloud-runner:1.2.0')).toBe('1.2.0');
    expect(runnerTagOf('ghcr.io/x/runner')).toBe('latest');
    expect(runnerTagOf('ghcr.io/x/runner@sha256:abcdef0123456789')).toBe('sha256:abcdef012345');
  });
});
