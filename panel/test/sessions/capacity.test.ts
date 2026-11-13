import { describe, expect, it } from 'vitest';
import type { HostStats } from '@/host/host-stats-types';
import {
  assertCapacity,
  assertFreeDisk,
  CapacityError,
  InsufficientDiskError,
  RUNNING_STATUSES,
} from '@/sessions/capacity';

const GB = 1024 ** 3;
const stats = (freeGb: number): HostStats => ({
  disk: { totalBytes: 500 * GB, freeBytes: freeGb * GB, path: '/' },
  cpu: { pct: 10 },
  memory: { totalBytes: 32 * GB, availableBytes: 16 * GB },
});

describe('capacity', () => {
  it('counts starting, working, waiting and idle as running', () => {
    expect([...RUNNING_STATUSES].sort()).toEqual(['idle', 'starting', 'waiting', 'working']);
  });

  it('rejects at max_running, allows below it', () => {
    expect(() => assertCapacity(2, 3)).not.toThrow();
    expect(() => assertCapacity(3, 3)).toThrow(CapacityError);
    expect(() => assertCapacity(4, 3)).toThrow(/3 sessions/);
  });

  it('refuses below min free disk, skips the check without stats', () => {
    expect(() => assertFreeDisk(stats(10), 10)).not.toThrow();
    expect(() => assertFreeDisk(stats(9.5), 10)).toThrow(InsufficientDiskError);
    expect(() => assertFreeDisk(null, 10)).not.toThrow();
  });
});
