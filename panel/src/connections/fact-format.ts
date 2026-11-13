import { formatClock } from '@/time/clock-time';
import { formatRelative } from '@/time/relative-time';

/** `Nov 13, 2:37 PM (in 3 hours)`, in the panel's time zone. For token expiries and refresh times. */
export function formatWhen(date: Date, now: Date, timeZone: string): string {
  return `${formatClock(date, timeZone)} (${formatRelative(date, now)})`;
}
