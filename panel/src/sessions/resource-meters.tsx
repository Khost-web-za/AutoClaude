import 'server-only';
import { Meter, Skeleton } from '@heroui/react';
import { getSettings } from '@/settings/settings-store';
import { readSessionResources, type SessionResources } from './session-resources';

const GB = 1024 ** 3;
const gb = (bytes: number) => (bytes / GB).toFixed(1);

function ResourceMeter({ label, value, used, limit }: { label: string; value: string; used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  return (
    <Meter aria-label={label} value={pct} minValue={0} maxValue={100} size="sm" className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-text-subtle">{label}</span>
        <span className="font-mono text-xs text-surface-foreground tabular-nums">{value}</span>
      </span>
      <Meter.Track>
        <Meter.Fill />
      </Meter.Track>
    </Meter>
  );
}

function Meters({ resources: r }: { resources: SessionResources }) {
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <ResourceMeter
        label="CPU"
        value={`${r.cpu.used.toFixed(1)}${r.cpu.limit ? ` / ${r.cpu.limit} cores` : ' cores'}`}
        used={r.cpu.used}
        limit={r.cpu.limit}
      />
      <ResourceMeter
        label="Memory"
        value={`${gb(r.memory.usedBytes)}${r.memory.limitBytes ? ` / ${gb(r.memory.limitBytes)}` : ''} GB`}
        used={r.memory.usedBytes}
        limit={r.memory.limitBytes}
      />
      {r.disk.usedBytes !== null ? (
        <ResourceMeter
          label="Disk"
          value={`${gb(r.disk.usedBytes)}${r.disk.limitBytes ? ` / ${gb(r.disk.limitBytes)}` : ''} GB`}
          used={r.disk.usedBytes}
          limit={r.disk.limitBytes}
        />
      ) : null}
    </div>
  );
}

/** One-shot CPU / memory / disk of the session container. Streams in behind ResourceMetersSkeleton. */
export async function ResourceMeters({ containerId, running }: { containerId: string | null; running: boolean }) {
  if (!running) return <p className="text-sm text-muted">Not running, so nothing to measure.</p>;
  const settings = await getSettings();
  const read = await readSessionResources(containerId, settings.diskGbPerSession);
  if (!read.ok) return <p className="text-sm text-muted">{read.message}</p>;
  return <Meters resources={read.resources} />;
}

export function ResourceMetersSkeleton() {
  return (
    <div aria-busy="true" className="flex max-w-sm flex-col gap-5">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full rounded-lg" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
