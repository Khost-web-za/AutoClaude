import type { UsageResetDisplay } from '@/db/schema';
import { formatHourMinute } from '@/time/clock-time';
import type { UsageWindow } from './usage-types';

export type UsageTone = 'ok' | 'warn' | 'danger';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function usageTone(pct: number, warnPct: number, dangerPct: number): UsageTone {
  if (pct >= dangerPct) return 'danger';
  if (pct >= warnPct) return 'warn';
  return 'ok';
}

function clockParts(date: Date, timeZone: string, withWeekday: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    ...(withWeekday ? { weekday: 'short' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  let text: string;
  try {
    text = new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
  } catch {
    text = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
  }
  // ICU may put a narrow no-break space before AM/PM and a comma after the weekday.
  return text.replace(/\s/g, ' ').replace(',', '');
}

function formatCountdown(diffMs: number): string {
  if (diffMs <= 0) return 'now';
  if (diffMs < MINUTE_MS) return 'in <1m';
  const days = Math.floor(diffMs / DAY_MS);
  const hours = Math.floor((diffMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((diffMs % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

/** The reset line for a usage window: `in 2h 14m` (countdown) or `at 2:37 PM` / `Sat 2:37 PM` (clock). */
export function formatReset(
  resetsAt: Date,
  now: Date,
  mode: UsageResetDisplay,
  timeZone: string,
): string {
  const diffMs = resetsAt.getTime() - now.getTime();
  if (mode === 'countdown') return formatCountdown(diffMs);
  if (diffMs > DAY_MS) return clockParts(resetsAt, timeZone, true);
  return `at ${clockParts(resetsAt, timeZone, false)}`;
}

/** A window whose reset time has passed has rolled over: it reads 0% until the next reading says otherwise. */
export function effectiveWindow(window: UsageWindow, now: Date): UsageWindow {
  if (window.resetsAt && window.resetsAt.getTime() <= now.getTime()) return { pct: 0, resetsAt: null };
  return window;
}

const STALE_AFTER_MS = 3 * MINUTE_MS;

/** `as of 03:12` (24 h, in the settings zone) once a reading is 3+ minutes old; null while it is fresh. */
export function staleLabel(fetchedAt: Date, now: Date, timeZone: string): string | null {
  if (now.getTime() - fetchedAt.getTime() < STALE_AFTER_MS) return null;
  const text = formatHourMinute(fetchedAt, timeZone);
  return `as of ${text}`;
}
