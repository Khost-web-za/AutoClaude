import { readCredentials as sharedReadCredentials, type ClaudeCredentials } from '@/claude/credentials-volume';
import { eventBus, type LiveEvent } from '@/live/event-bus';
import type { UsageSnapshot, UsageWindow } from './usage-types';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type UsageFailureReason = 'no-credentials' | 'expired' | `http-${number}` | 'unavailable';
export type UsageResult = { ok: true; snapshot: UsageSnapshot } | { ok: false; reason: UsageFailureReason };

export type UsageClientDeps = {
  fetch: typeof fetch;
  now: () => number;
  readCredentials: () => Promise<ClaudeCredentials | null>;
  publish: (event: LiveEvent) => void;
  warn: (message: string) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Utilization is a percent (35.0 observed), taken as-is even when <= 1. */
function parseWindow(value: unknown): UsageWindow | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const { utilization, resets_at: resetsAtRaw } = raw;
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  let resetsAt: Date | null = null;
  if (typeof resetsAtRaw === 'string') {
    const parsed = new Date(resetsAtRaw);
    if (!Number.isNaN(parsed.getTime())) resetsAt = parsed;
  }
  return { pct: utilization, resetsAt };
}

function extraLabel(key: string): string {
  return key
    .replace(/^seven_day_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The undocumented response, parsed defensively. Null unless both `five_hour` and `seven_day` are usable. */
export function parseUsage(body: unknown, fetchedAt: Date): UsageSnapshot | null {
  const raw = asRecord(body);
  if (!raw) return null;
  const fiveHour = parseWindow(raw.five_hour);
  const weekly = parseWindow(raw.seven_day);
  if (!fiveHour || !weekly) return null;
  const extra: UsageSnapshot['extra'] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('seven_day_')) continue;
    const window = parseWindow(value);
    if (window) extra.push({ ...window, label: extraLabel(key) });
  }
  return { fiveHour, weekly, extra, fetchedAt };
}

export function createUsageClient(deps: UsageClientDeps) {
  let cached: { at: number; result: UsageResult } | null = null;
  let inFlight: Promise<UsageResult> | null = null;
  const loggedReasons = new Set<string>();

  function fail(reason: UsageFailureReason): UsageResult {
    if (!loggedReasons.has(reason)) {
      loggedReasons.add(reason);
      deps.warn(`[usage] unavailable: ${reason}`);
    }
    return { ok: false, reason };
  }

  async function load(): Promise<UsageResult> {
    let credentials: ClaudeCredentials | null;
    try {
      credentials = await deps.readCredentials();
    } catch {
      return fail('unavailable');
    }
    if (!credentials) return fail('no-credentials');
    const { accessToken, expiresAt } = credentials.claudeAiOauth;
    // Never refresh: the runners keep the shared file fresh and rotating the token here would break them.
    if (expiresAt <= deps.now()) return fail('expired');
    try {
      const response = await deps.fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (response.status !== 200) return fail(`http-${response.status}`);
      const snapshot = parseUsage(await response.json(), new Date(deps.now()));
      if (!snapshot) return fail('unavailable');
      loggedReasons.clear();
      return { ok: true, snapshot };
    } catch {
      return fail('unavailable');
    }
  }

  async function getUsageResult(): Promise<UsageResult> {
    if (cached && deps.now() - cached.at < CACHE_MS) return cached.result;
    inFlight ??= load()
      .then((result) => {
        cached = { at: deps.now(), result };
        deps.publish({ kind: 'usage', usage: result.ok ? result.snapshot : null });
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    getUsageResult,
    async getUsage(): Promise<UsageSnapshot | null> {
      const result = await getUsageResult();
      return result.ok ? result.snapshot : null;
    },
  };
}

export type UsageClient = ReturnType<typeof createUsageClient>;

const globalForUsage = globalThis as typeof globalThis & { __usageClient?: UsageClient };

/** The app's client, on globalThis so the 60 s cache survives module re-evaluation. */
function sharedUsageClient(): UsageClient {
  return (globalForUsage.__usageClient ??= createUsageClient({
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    readCredentials: sharedReadCredentials,
    publish: (event) => eventBus.publish(event),
    warn: (message) => console.warn(message),
  }));
}

export const getUsage = () => sharedUsageClient().getUsage();
export const getUsageResult = () => sharedUsageClient().getUsageResult();
