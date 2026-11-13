'use client';

import { Meter } from '@heroui/react';
import { useState } from 'react';
import { useLive } from '@/live/use-live';
import type { HostStats } from './host-stats-types';

const GB = 1024 ** 3;

function DiskBar({ stats }: { stats: HostStats }) {
  const { totalBytes, freeBytes } = stats.disk;
  const usedPct = totalBytes > 0 ? Math.min(100, Math.max(0, ((totalBytes - freeBytes) / totalBytes) * 100)) : 0;
  return (
    <Meter aria-label="Host disk used" value={usedPct} minValue={0} maxValue={100} size="sm" className="w-16">
      <Meter.Track>
        <Meter.Fill />
      </Meter.Track>
    </Meter>
  );
}

/** Disk and CPU readings: server-rendered first, then replaced by pushed `host` events. */
export function HostStatsLive({ initial }: { initial: HostStats | null }) {
  const [state, setState] = useState({ initial, stats: initial });
  // A router.refresh() hands down fresh server data: it replaces whatever was pushed before it.
  if (state.initial !== initial) setState({ initial, stats: initial });
  const stats = state.initial === initial ? state.stats : initial;
  useLive((event) => {
    if (event.kind === 'host') setState((current) => ({ ...current, stats: event.stats }));
  });

  if (!stats) return <span className="whitespace-nowrap">stats unavailable</span>;
  return (
    <>
      <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
        <span>
          Disk <span className="text-muted">{Math.round(stats.disk.freeBytes / GB)} GB</span> free
        </span>
        <DiskBar stats={stats} />
      </span>
      <span className="whitespace-nowrap tabular-nums">
        CPU <span className="text-muted">{Math.round(stats.cpu.pct)} %</span>
      </span>
    </>
  );
}
