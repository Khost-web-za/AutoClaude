import { Meter } from '@heroui/react';
import { formatReset, usageTone, type UsageTone } from './usage-format';
import type { UsageViewSettings } from './usage-data';
import type { UsageWindow } from './usage-types';

const TONE_COLOR: Record<UsageTone, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
};

export const TONE_TEXT: Record<UsageTone, string> = {
  ok: 'text-accent-text',
  warn: 'text-status-waiting',
  danger: 'text-status-failed',
};

export function roundPct(pct: number): number {
  return Math.round(pct);
}

/** A labelled usage bar with its percentage and, when the window reports one, its reset time. */
export function UsageWindowRow({
  label,
  window,
  now,
  settings,
  className = '',
}: {
  label: string;
  window: UsageWindow;
  now: Date;
  settings: UsageViewSettings;
  className?: string;
}) {
  const tone = usageTone(window.pct, settings.warnPct, settings.dangerPct);
  const value = Math.min(100, Math.max(0, window.pct));
  return (
    <Meter
      aria-label={`${label} usage`}
      value={value}
      minValue={0}
      maxValue={100}
      color={TONE_COLOR[tone]}
      size="sm"
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <Meter.Output className={`font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
          {`${roundPct(window.pct)}%`}
        </Meter.Output>
        <span className="font-medium text-muted">{label}</span>
      </div>
      <Meter.Track>
        <Meter.Fill />
      </Meter.Track>
      {window.resetsAt ? (
        <span className="text-xs text-text-subtle">
          {formatReset(window.resetsAt, now, settings.resetDisplay, settings.timeZone)}
        </span>
      ) : null}
    </Meter>
  );
}
