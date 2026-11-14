import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ClaudeCredentials } from '@/claude/credentials-volume';
import { createUsageClient, parseUsage, type UsageClientDeps } from '@/usage/usage-client';
import type { UsageSnapshot } from '@/usage/usage-types';

const sample: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'usage', 'oauth-usage-pro.json'), 'utf8'),
);

const NOW = Date.parse('2026-11-12T12:00:00Z');

function creds(expiresAt: number): ClaudeCredentials {
  return {
    claudeAiOauth: {
      accessToken: 'tok-secret',
      refreshToken: 'ref-secret',
      expiresAt,
      subscriptionType: 'pro',
      scopes: [],
    },
  };
}

function setup(overrides: Partial<UsageClientDeps> = {}, initialResponse: () => Response = () => Response.json(sample)) {
  let response = initialResponse;
  let now = NOW;
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => response());
  const publish = vi.fn();
  const warn = vi.fn();
  const client = createUsageClient({
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
    readCredentials: async () => creds(NOW + 3_600_000),
    publish,
    warn,
    loadLast: async () => null,
    saveLast: async () => {},
    ...overrides,
  });
  return { client, fetchMock, publish, warn, setResponse: (next: () => Response) => (response = next), advance: (ms: number) => (now += ms) };
}

describe('parseUsage', () => {
  it('parses the recorded Pro sample into percentages and dates', () => {
    const snapshot = parseUsage(sample, new Date(NOW));
    expect(snapshot).not.toBeNull();
    expect(snapshot?.fiveHour.pct).toBe(35);
    expect(snapshot?.fiveHour.resetsAt?.toISOString()).toBe('2026-11-12T16:40:00.123Z');
    expect(snapshot?.weekly.pct).toBe(5);
    expect(snapshot?.weekly.resetsAt?.toISOString()).toBe('2026-11-18T09:00:00.000Z');
    expect(snapshot?.extra).toEqual([]);
    expect(snapshot?.fetchedAt.getTime()).toBe(NOW);
  });

  it('adds per-model weekly windows only when non-null and treats values <= 1 as percent', () => {
    const body = {
      five_hour: { utilization: 0.5, resets_at: null },
      seven_day: { utilization: 1 },
      seven_day_opus: { utilization: 61.5, resets_at: '2026-11-18T09:00:00+00:00' },
      seven_day_sonnet: null,
    };
    const snapshot = parseUsage(body, new Date(NOW));
    expect(snapshot?.fiveHour).toEqual({ pct: 0.5, resetsAt: null });
    expect(snapshot?.weekly).toEqual({ pct: 1, resetsAt: null });
    expect(snapshot?.extra).toHaveLength(1);
    expect(snapshot?.extra[0]).toMatchObject({ label: 'Opus', pct: 61.5 });
  });

  it('returns null when the two main windows are missing or malformed', () => {
    expect(parseUsage(null, new Date(NOW))).toBeNull();
    expect(parseUsage({ five_hour: { utilization: 'x' }, seven_day: { utilization: 1 } }, new Date(NOW))).toBeNull();
    expect(parseUsage({ five_hour: { utilization: 1 } }, new Date(NOW))).toBeNull();
  });
});

describe('getUsage', () => {
  it('fetches with the bearer token and beta header and publishes a usage event', async () => {
    const { client, fetchMock, publish } = setup();
    const snapshot = await client.getUsage();
    expect(snapshot?.fiveHour.pct).toBe(35);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/api/oauth/usage');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer tok-secret');
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(publish).toHaveBeenCalledWith({ kind: 'usage', usage: snapshot, stale: false, reason: null });
  });

  it('401 gives null with reason http-401, logged once, without leaking the token', async () => {
    const { client, warn } = setup({}, () => new Response('no', { status: 401 }));
    expect(await client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'http-401' });
    expect(await client.getUsage()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tok-secret');
  });

  it('expired credentials give null expired and make no HTTP call', async () => {
    const { client, fetchMock } = setup({ readCredentials: async () => creds(NOW - 1) });
    expect(await client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'expired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('missing credentials give no-credentials', async () => {
    const { client, fetchMock } = setup({ readCredentials: async () => null });
    expect(await client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'no-credentials' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('network errors and unparsable bodies give unavailable and never throw', async () => {
    const boom = setup({ fetch: (async () => Promise.reject(new Error('down'))) as typeof fetch });
    expect(await boom.client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'unavailable' });
    const junk = setup({}, () => new Response('not json', { status: 200 }));
    expect(await junk.client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'unavailable' });
  });

  it('caches for 60 s, then fetches again', async () => {
    const { client, fetchMock, advance } = setup();
    await client.getUsage();
    advance(59_000);
    await client.getUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(2_000);
    await client.getUsage();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const { client, fetchMock } = setup();
    await Promise.all([client.getUsage(), client.getUsage()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('last good snapshot', () => {
  const persisted: UsageSnapshot = {
    fiveHour: { pct: 10, resetsAt: new Date('2026-11-12T15:00:00Z') },
    weekly: { pct: 20, resetsAt: null },
    extra: [],
    fetchedAt: new Date(NOW - 600_000),
  };

  it('keeps the last good snapshot after a failure', async () => {
    const { client, setResponse, advance } = setup();
    const first = await client.getUsageResult();
    expect(first).toMatchObject({ stale: false, reason: null });
    setResponse(() => new Response('boom', { status: 500 }));
    advance(61_000);
    const second = await client.getUsageResult();
    expect(second).toEqual({ snapshot: first.snapshot, stale: true, reason: 'http-500' });
  });

  it('loads the persisted snapshot when the first fetch fails', async () => {
    const { client } = setup({ loadLast: async () => persisted }, () => new Response('slow', { status: 429 }));
    expect(await client.getUsageResult()).toEqual({ snapshot: persisted, stale: true, reason: 'http-429' });
  });

  it('saves each good snapshot', async () => {
    const saveLast = vi.fn(async (_snapshot: UsageSnapshot) => {});
    const { client, advance } = setup({ saveLast });
    await client.getUsage();
    advance(61_000);
    await client.getUsage();
    expect(saveLast).toHaveBeenCalledTimes(2);
    expect(saveLast.mock.calls[0]![0].fiveHour.pct).toBe(35);
  });

  it('never throws when persistence fails', async () => {
    const { client } = setup({
      loadLast: async () => Promise.reject(new Error('db down')),
      saveLast: async () => Promise.reject(new Error('db down')),
    });
    expect((await client.getUsageResult()).snapshot?.fiveHour.pct).toBe(35);
    const failing = setup({ loadLast: async () => Promise.reject(new Error('db down')) }, () => new Response('x', { status: 500 }));
    expect(await failing.client.getUsageResult()).toEqual({ snapshot: null, stale: false, reason: 'http-500' });
  });

  it('waits 5 minutes after a 429', async () => {
    const { client, fetchMock, advance } = setup({}, () => new Response('slow', { status: 429 }));
    await client.getUsage();
    advance(61_000);
    await client.getUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(5 * 60_000);
    await client.getUsage();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refresh bypasses the cache', async () => {
    const { client, fetchMock } = setup();
    await client.getUsage();
    await client.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('publishes stale and reason', async () => {
    const { client, publish, setResponse, advance } = setup();
    await client.getUsage();
    setResponse(() => new Response('boom', { status: 500 }));
    advance(61_000);
    const result = await client.getUsageResult();
    expect(publish).toHaveBeenLastCalledWith({ kind: 'usage', usage: result.snapshot, stale: true, reason: 'http-500' });
  });

  it('snapshot is null only when nothing was ever good', async () => {
    const { client } = setup({}, () => new Response('boom', { status: 500 }));
    const result = await client.getUsageResult();
    expect(result).toEqual({ snapshot: null, stale: false, reason: 'http-500' });
  });
});
