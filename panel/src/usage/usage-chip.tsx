'use client';

import { Popover } from '@heroui/react';
import { Gauge } from 'lucide-react';
import { effectiveWindow, staleLabel, usageTone } from './usage-format';
import { unavailableDetail } from './usage-labels';
import type { UsageViewData } from './usage-data';
import { roundPct, TONE_TEXT, UsageWindowRow } from './usage-window-row';
import { useLiveUsage } from './use-live-usage';
import { useClock } from '@/time/use-clock';

/** Mobile header: one chip with the higher of the two percentages; the popover lists everything. */
export function UsageChip({ data: initial, className = '' }: { data: UsageViewData; className?: string }) {
  const data = useLiveUsage(initial);
  const now = useClock(data.renderedAt);
  const { snapshot, settings } = data;
  const top = snapshot
    ? Math.max(effectiveWindow(snapshot.fiveHour, now).pct, effectiveWindow(snapshot.weekly, now).pct)
    : null;
  const stale = snapshot ? staleLabel(snapshot.fetchedAt, now, settings.timeZone) : null;
  const tone = top === null ? 'ok' : usageTone(top, settings.warnPct, settings.dangerPct);

  return (
    <Popover>
      <Popover.Trigger
        className={`flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold ${className}`}
      >
        <button type="button" aria-label="Claude usage" className="flex items-center gap-1.5">
          <Gauge aria-hidden className={`size-4 ${top === null ? 'text-text-subtle' : TONE_TEXT[tone]}`} />
          <span className={`tabular-nums ${top === null ? 'text-text-subtle' : TONE_TEXT[tone]}`}>
            {top === null ? '--' : `${roundPct(top)}%`}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label="Claude usage" className="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-4 p-4">
          {snapshot ? (
            <>
              <UsageWindowRow label="5 hours" window={snapshot.fiveHour} now={now} settings={settings} />
              <UsageWindowRow label="Week" window={snapshot.weekly} now={now} settings={settings} />
              {snapshot.extra.map((window) => (
                <UsageWindowRow
                  key={window.label}
                  label={`${window.label} (week)`}
                  window={window}
                  now={now}
                  settings={settings}
                />
              ))}
              {stale ? <p className="text-xs text-text-subtle">{stale}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">Usage unavailable. </span>
              {unavailableDetail(data.reason)}
            </p>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
