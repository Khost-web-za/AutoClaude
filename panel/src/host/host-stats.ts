import { getPanelEnv } from '@/env/panel-env';
import { eventBus, type LiveEvent } from '@/live/event-bus';
import type { HostStats } from './host-stats-types';

const CACHE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 1_000;

export type HostStatsClientDeps = {
  url: string;
  fetch: typeof fetch;
  now: () => number;
  publish: (event: LiveEvent) => void;
  warn: (message: string) => void;
  timeoutMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The sidecar's JSON, checked field by field; null unless every field is usable. */
export function parseHostStats(body: unknown): HostStats | null {
  const raw = asRecord(body);
  const disk = asRecord(raw?.disk);
  const cpu = asRecord(raw?.cpu);
  const memory = asRecord(raw?.memory);
  if (!disk || !cpu || !memory) return null;
  if (!isCount(disk.totalBytes) || !isCount(disk.freeBytes) || typeof disk.path !== 'string') return null;
  if (!isCount(cpu.pct) || !isCount(memory.totalBytes) || !isCount(memory.availableBytes)) return null;
  return {
    disk: { totalBytes: disk.totalBytes, freeBytes: disk.freeBytes, path: disk.path },
    cpu: { pct: cpu.pct },
    memory: { totalBytes: memory.totalBytes, availableBytes: memory.availableBytes },
  };
}

export function createHostStatsClient(deps: HostStatsClientDeps) {
  let cached: { at: number; stats: HostStats | null } | null = null;
  let inFlight: Promise<HostStats | null> | null = null;
  let warned = false;

  async function load(): Promise<HostStats | null> {
    try {
      const response = await deps.fetch(new URL('/stats', deps.url), {
        signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (response.status !== 200) throw new Error(`http ${response.status}`);
      const stats = parseHostStats(await response.json());
      if (!stats) throw new Error('unexpected response shape');
      warned = false;
      return stats;
    } catch (error) {
      if (!warned) {
        warned = true;
        deps.warn(`[hoststats] unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    }
  }

  /** Null when the sidecar is unreachable, slow (1 s) or answers nonsense; callers treat that as "unknown". */
  async function fetchHostStats(): Promise<HostStats | null> {
    if (cached && deps.now() - cached.at < CACHE_MS) return cached.stats;
    inFlight ??= load()
      .then((stats) => {
        cached = { at: deps.now(), stats };
        try {
          deps.publish({ kind: 'host', stats });
        } catch {
          // a broken subscriber must never fail the read
        }
        return stats;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return { fetchHostStats };
}

export type HostStatsClient = ReturnType<typeof createHostStatsClient>;

const globalForHostStats = globalThis as typeof globalThis & { __hostStatsClient?: HostStatsClient };

/** The app's client, on globalThis so the 15 s cache survives module re-evaluation. */
function sharedHostStatsClient(): HostStatsClient {
  return (globalForHostStats.__hostStatsClient ??= createHostStatsClient({
    url: getPanelEnv().hoststatsUrl,
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    publish: (event) => eventBus.publish(event),
    warn: (message) => console.warn(message),
  }));
}

export const fetchHostStats = () => sharedHostStatsClient().fetchHostStats();

/** `claudecloud-runner:1.2.0` -> `1.2.0`; a digest reference is shortened; no tag means `latest`. */
export function runnerTagOf(image: string): string {
  const digest = image.split('@')[1];
  if (digest) return digest.slice(0, 19);
  const name = image.slice(image.lastIndexOf('/') + 1);
  const colon = name.indexOf(':');
  return colon === -1 ? 'latest' : name.slice(colon + 1);
}
