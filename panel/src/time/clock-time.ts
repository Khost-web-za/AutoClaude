const OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

/** `Nov 13, 2:37 PM` in the panel's time zone (UTC when the zone is unknown). */
export function formatClock(date: Date, timeZone: string): string {
  let text: string;
  try {
    text = new Intl.DateTimeFormat('en-US', { ...OPTIONS, timeZone }).format(date);
  } catch {
    text = new Intl.DateTimeFormat('en-US', { ...OPTIONS, timeZone: 'UTC' }).format(date);
  }
  return text.replace(/\s/g, ' ');
}

const HOUR_MINUTE_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** `03:12` (24 h) in the given zone, UTC when the zone is unknown. */
export function formatHourMinute(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...HOUR_MINUTE_OPTIONS, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...HOUR_MINUTE_OPTIONS, timeZone: 'UTC' }).format(date);
  }
}
