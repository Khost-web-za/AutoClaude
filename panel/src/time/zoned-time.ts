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

const DAY_MS = 24 * 60 * 60_000;

/**
 * The instant at which the clocks in `timeZone` read `local` (`YYYY-MM-DDTHH:mm`). An ambiguous time
 * (clocks go back) takes the first occurrence; a time skipped by a spring-forward change moves forward
 * by the length of the gap (02:30 in a 02:00 -> 03:00 gap becomes 03:30).
 */
export function wallTimeToInstant(local: string, timeZone: string): Date {
  const match = WALL_TIME.exec(local);
  if (!match) throw new Error(`Not a YYYY-MM-DDTHH:mm wall time: ${local}`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetBefore = offsetMinutes(new Date(asUtc - DAY_MS), timeZone);
  const offsetAfter = offsetMinutes(new Date(asUtc + DAY_MS), timeZone);
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => asUtc - offset * 60_000)
    .filter((instant) => instantToWallTime(new Date(instant), timeZone) === local)
    .sort((x, y) => x - y);
  // No candidate reads `local`: it falls in a gap, so apply the pre-change offset to land after it.
  return new Date(candidates[0] ?? asUtc - offsetBefore * 60_000);
}

/** The next instant after `now` at which the clocks in `timeZone` read `time` (`HH:mm`): later today, else tomorrow. */
export function nextWallClock(time: string, timeZone: string, now: Date): Date {
  const today = instantToWallTime(now, timeZone).slice(0, 10);
  const todays = wallTimeToInstant(`${today}T${time}`, timeZone);
  if (todays.getTime() > now.getTime()) return todays;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return wallTimeToInstant(`${tomorrow}T${time}`, timeZone);
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
