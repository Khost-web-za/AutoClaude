import type Docker from 'dockerode';
import { dockerStatusCode } from '@/docker/docker-errors';
import { sharedSessionDeps, type SessionDocker } from './session-deps';

const GB = 1024 ** 3;
const STATS_TIMEOUT_MS = 8_000;

export type SessionResources = {
  /** Cores in use over Docker's sampling interval, and the NanoCpus limit in cores. */
  cpu: { used: number; limit: number | null };
  memory: { usedBytes: number; limitBytes: number | null };
  /** The container's writable layer (SizeRw); the limit is the storage quota, else the per-session setting. */
  disk: { usedBytes: number | null; limitBytes: number | null };
};

type Num = number | undefined;
type StatsBody = {
  cpu_stats?: { cpu_usage?: { total_usage?: Num }; system_cpu_usage?: Num; online_cpus?: Num };
  precpu_stats?: { cpu_usage?: { total_usage?: Num }; system_cpu_usage?: Num };
  memory_stats?: { usage?: Num; limit?: Num; stats?: { inactive_file?: Num; total_inactive_file?: Num; cache?: Num } };
};
type InspectBody = {
  SizeRw?: Num;
  HostConfig?: { NanoCpus?: Num; Memory?: Num; StorageOpt?: Record<string, string> | null };
};

const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const positive = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null);

/** `40G` / `512M` / bytes → bytes. */
function storageBytes(size: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i.exec(size?.trim() ?? '');
  if (!match) return null;
  const power = ' kmgt'.indexOf((match[2] || ' ').toLowerCase());
  return Math.round(Number(match[1]) * 1024 ** power);
}

/** Pure: Docker's stats and inspect bodies to what the Overview meters show. */
export function parseContainerResources(stats: unknown, inspect: unknown, diskGbSetting: number): SessionResources {
  const s = (stats ?? {}) as StatsBody;
  const i = (inspect ?? {}) as InspectBody;
  const cpuDelta = n(s.cpu_stats?.cpu_usage?.total_usage) - n(s.precpu_stats?.cpu_usage?.total_usage);
  const systemDelta = n(s.cpu_stats?.system_cpu_usage) - n(s.precpu_stats?.system_cpu_usage);
  const cpus = n(s.cpu_stats?.online_cpus) || 1;
  const used = cpuDelta > 0 && systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * cpus * 100) / 100 : 0;
  // cgroup v2 reports page cache as inactive_file (v1: total_inactive_file); `docker stats` subtracts it too.
  const memStats = s.memory_stats?.stats;
  const cache = n(memStats?.inactive_file ?? memStats?.total_inactive_file);
  const memUsed = Math.max(0, n(s.memory_stats?.usage) - cache);
  return {
    cpu: { used, limit: positive(i.HostConfig?.NanoCpus) === null ? null : n(i.HostConfig?.NanoCpus) / 1e9 },
    memory: { usedBytes: memUsed, limitBytes: positive(i.HostConfig?.Memory) ?? positive(s.memory_stats?.limit) },
    disk: {
      usedBytes: typeof i.SizeRw === 'number' ? i.SizeRw : null,
      limitBytes: storageBytes(i.HostConfig?.StorageOpt?.size) ?? (diskGbSetting > 0 ? diskGbSetting * GB : null),
    },
  };
}

export type ResourcesRead = { ok: true; resources: SessionResources } | { ok: false; message: string };

/** One-shot `docker stats` plus an inspect with sizes. Never throws; a stopped container has nothing to show. */
export async function readSessionResources(
  containerId: string | null,
  diskGbSetting: number,
  docker: SessionDocker = sharedSessionDeps().docker,
): Promise<ResourcesRead> {
  if (!containerId) return { ok: false, message: 'No container.' };
  const container = docker.getContainer(containerId);
  let timer: NodeJS.Timeout | undefined;
  try {
    const [stats, inspect] = await Promise.race([
      // `size` (SizeRw) is an Engine API query option dockerode passes through but does not type.
      Promise.all([container.stats({ stream: false }), container.inspect({ size: true } as Docker.ContainerInspectOptions)]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), STATS_TIMEOUT_MS);
      }),
    ]);
    if (!(inspect as { State?: { Running?: boolean } }).State?.Running) {
      return { ok: false, message: 'The container is not running.' };
    }
    return { ok: true, resources: parseContainerResources(stats, inspect, diskGbSetting) };
  } catch (error) {
    if (dockerStatusCode(error) === 404) return { ok: false, message: 'The container is gone.' };
    console.error('[sessions] reading container stats failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, message: 'Resource use is unavailable right now.' };
  } finally {
    clearTimeout(timer);
  }
}
