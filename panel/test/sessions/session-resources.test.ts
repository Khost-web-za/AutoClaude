import { describe, expect, it } from 'vitest';
import { parseContainerResources } from '@/sessions/session-resources';

const GB = 1024 ** 3;

describe('parseContainerResources', () => {
  it('computes CPU cores from the two samples, memory without page cache, disk from SizeRw', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 2_000_000_000 }, system_cpu_usage: 20_000_000_000, online_cpus: 8 },
      precpu_stats: { cpu_usage: { total_usage: 1_000_000_000 }, system_cpu_usage: 10_000_000_000 },
      memory_stats: { usage: 3 * GB, limit: 8 * GB, stats: { inactive_file: 1 * GB } },
    };
    const inspect = { SizeRw: 6 * GB, HostConfig: { NanoCpus: 4e9, Memory: 8 * GB, StorageOpt: { size: '40G' } } };
    expect(parseContainerResources(stats, inspect, 40)).toEqual({
      cpu: { used: 0.8, limit: 4 },
      memory: { usedBytes: 2 * GB, limitBytes: 8 * GB },
      disk: { usedBytes: 6 * GB, limitBytes: 40 * GB },
    });
  });

  it('missing samples read as zero, and the disk limit falls back to the setting', () => {
    const result = parseContainerResources({}, { HostConfig: {} }, 40);
    expect(result).toEqual({
      cpu: { used: 0, limit: null },
      memory: { usedBytes: 0, limitBytes: null },
      disk: { usedBytes: null, limitBytes: 40 * GB },
    });
  });
});
