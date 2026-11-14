import { Chip } from '@heroui/react';
import type { KickoffStatus } from '@/db/schema';
import { formatClock } from '@/time/clock-time';
import type { KickoffView } from './kickoff-view';

type FinishedStatus = Exclude<KickoffStatus, 'scheduled'>;

const STATUS: Record<FinishedStatus, { label: string; color: 'success' | 'danger' | 'warning' | 'default' }> = {
  running: { label: 'Running', color: 'warning' },
  started: { label: 'Started', color: 'success' },
  skipped: { label: 'Skipped', color: 'default' },
  failed: { label: 'Failed', color: 'danger' },
};

/** One page of kick-offs that have run: when, how it ended and the short outcome. */
export function KickoffHistory({ rows, timeZone }: { rows: readonly KickoffView[]; timeZone: string }) {
  if (rows.length === 0) return <p className="py-4 text-sm text-muted">No kick-offs have run yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => {
        const status = STATUS[row.status as FinishedStatus];
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <span className="text-sm font-semibold text-white">{formatClock(new Date(row.runAt), timeZone)}</span>
            <Chip size="sm" variant="soft" color={status.color}>
              {status.label}
            </Chip>
            {row.outcome ? <span className="w-full text-sm text-muted sm:w-auto">{row.outcome}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
