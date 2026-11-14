'use client';

import { Tooltip } from '@heroui/react';
import { staleLabel } from './usage-format';
import { unavailableDetail } from './usage-labels';
import type { UsageViewData } from './usage-data';
import { UsageWindowRow } from './usage-window-row';
import { useLiveUsage } from './use-live-usage';
import { useClock } from '@/time/use-clock';

/** Desktop header: the 5-hour and weekly bars side by side; per-model weekly windows in the tooltip. */
export function UsageMeters({ data: initial, className = '' }: { data: UsageViewData; className?: string }) {
  const data = useLiveUsage(initial);
  const now = useClock(data.renderedAt);
  const { snapshot, settings } = data;

  const stale = snapshot ? staleLabel(snapshot.fetchedAt, now, settings.timeZone) : null;

  if (!snapshot) {
    return (
      <Tooltip delay={200}>
        <Tooltip.Trigger className={className}>
          <span tabIndex={0} className="rounded-md px-2 py-1 text-xs text-text-subtle outline-focus focus-visible:outline-2">
            Usage unavailable
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{unavailableDetail(data.reason)}</Tooltip.Content>
      </Tooltip>
    );
  }

  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger className={className}>
        <div tabIndex={0} className="flex items-start gap-5 rounded-md px-2 py-1 outline-focus focus-visible:outline-2">
          <UsageWindowRow label="5 hours" window={snapshot.fiveHour} now={now} settings={settings} className="w-32" />
          <UsageWindowRow label="Week" window={snapshot.weekly} now={now} settings={settings} className="w-32" />
          {stale ? <span className="self-center text-xs text-text-subtle">{stale}</span> : null}
        </div>
      </Tooltip.Trigger>
      {snapshot.extra.length > 0 ? (
        <Tooltip.Content>
          <ul className="flex flex-col gap-1 text-xs">
            {snapshot.extra.map((window) => (
              <li key={window.label} className="flex justify-between gap-4">
                <span>{window.label} (week)</span>
                <span className="tabular-nums">{Math.round(window.pct)}%</span>
              </li>
            ))}
          </ul>
        </Tooltip.Content>
      ) : (
        <Tooltip.Content>Claude usage, updated live.</Tooltip.Content>
      )}
    </Tooltip>
  );
}
