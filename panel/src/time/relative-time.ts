const STEPS: [suffix: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
];

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

/** The largest whole unit of a past duration (`3d`, `2h`, `5m`), or null under a minute (future counts as now). */
function compactElapsed(date: Date, now: Date): string | null {
  const elapsed = now.getTime() - date.getTime();
  for (const [suffix, ms] of STEPS) {
    if (elapsed >= ms) return `${Math.floor(elapsed / ms)}${suffix}`;
  }
  return null;
}

/** Compact age for list rows: `3d ago`, `2h ago`, `5m ago`, `just now` (future dates count as now). */
export function formatAgo(date: Date, now: Date): string {
  const elapsed = compactElapsed(date, now);
  return elapsed ? `${elapsed} ago` : 'just now';
}

/** A bare age for table columns: `3d`, `2h`, `38m`, `<1m`. */
export function formatAge(date: Date, now: Date): string {
  return compactElapsed(date, now) ?? '<1m';
}

/** Either direction in words: `3 hours ago`, `in 20 minutes`, `tomorrow`, `just now`. */
export function formatRelative(date: Date, now: Date): string {
  const diff = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}
