import { docker } from '@/docker/docker-client';

const CACHE_MS = 5 * 60_000;
let cached: { value: boolean; at: number } | undefined;

/** True when the Docker daemon has the sysbox-runc runtime registered. Cached for 5 minutes. */
export async function hasSysbox(now: number = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const info = (await docker.info()) as { Runtimes?: Record<string, unknown> };
  const value = Boolean(info.Runtimes?.['sysbox-runc']);
  cached = { value, at: now };
  return value;
}

export function resetSysboxCache(): void {
  cached = undefined;
}
