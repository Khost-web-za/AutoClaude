const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Offset of `timeZone` from UTC at `at`, in minutes (positive east of UTC). */
function offsetMinutes(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(part ?? '');
  if (!match) throw new Error(`Cannot read the UTC offset of ${timeZone}`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * The instant at which the clocks in `timeZone` read `local` (`YYYY-MM-DDTHH:mm`). A time skipped by a
 * spring-forward change resolves to the instant after the gap.
 */
export function wallTimeToInstant(local: string, timeZone: string): Date {
  const match = WALL_TIME.exec(local);
  if (!match) throw new Error(`Not a YYYY-MM-DDTHH:mm wall time: ${local}`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const first = asUtc - offsetMinutes(new Date(asUtc), timeZone) * 60_000;
  // The offset at the first guess can differ from the offset at `asUtc` across a DST change.
  const second = asUtc - offsetMinutes(new Date(first), timeZone) * 60_000;
  return new Date(second);
}

/** `YYYY-MM-DDTHH:mm` as the clocks in `timeZone` read at `at`. */
export function instantToWallTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
