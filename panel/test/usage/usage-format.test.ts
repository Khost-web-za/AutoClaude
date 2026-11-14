import { describe, expect, it } from 'vitest';
import { effectiveWindow, formatReset, staleLabel, usageTone } from '@/usage/usage-format';

const now = new Date('2026-11-12T12:00:00Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('formatReset countdown', () => {
  it('formats hours + minutes, days + hours and minutes only', () => {
    expect(formatReset(at(2 * HOUR + 14 * MIN), now, 'countdown', 'UTC')).toBe('in 2h 14m');
    expect(formatReset(at(2 * 24 * HOUR + 6 * HOUR + 10 * MIN), now, 'countdown', 'UTC')).toBe('in 2d 6h');
    expect(formatReset(at(45 * MIN), now, 'countdown', 'UTC')).toBe('in 45m');
  });
  it('handles the day rollover and a reset in the past', () => {
    expect(formatReset(at(24 * HOUR), now, 'countdown', 'UTC')).toBe('in 1d 0h');
    expect(formatReset(at(23 * HOUR + 59 * MIN), now, 'countdown', 'UTC')).toBe('in 23h 59m');
    expect(formatReset(at(-5 * MIN), now, 'countdown', 'UTC')).toBe('now');
    expect(formatReset(at(20_000), now, 'countdown', 'UTC')).toBe('in <1m');
  });
});

describe('formatReset clock', () => {
  it('shows just the time within 24 h, in the given time zone', () => {
    expect(formatReset(new Date('2026-11-12T14:37:00Z'), now, 'clock', 'UTC')).toBe('at 2:37 PM');
    expect(formatReset(new Date('2026-11-12T14:37:00Z'), now, 'clock', 'Europe/Berlin')).toBe('at 3:37 PM');
  });
  it('adds the weekday beyond 24 h, using the zone for the day too', () => {
    // 2026-11-14 is a Saturday; 23:30 UTC is already Sunday in Berlin.
    expect(formatReset(new Date('2026-11-14T14:37:00Z'), now, 'clock', 'UTC')).toBe('Sat 2:37 PM');
    expect(formatReset(new Date('2026-11-14T23:30:00Z'), now, 'clock', 'Europe/Berlin')).toBe('Sun 12:30 AM');
  });
  it('falls back to UTC for an unknown zone', () => {
    expect(formatReset(new Date('2026-11-12T14:37:00Z'), now, 'clock', 'Nope/Zone')).toBe('at 2:37 PM');
  });
});

describe('usageTone', () => {
  it('uses inclusive thresholds', () => {
    expect(usageTone(79, 80, 95)).toBe('ok');
    expect(usageTone(80, 80, 95)).toBe('warn');
    expect(usageTone(94.9, 80, 95)).toBe('warn');
    expect(usageTone(95, 80, 95)).toBe('danger');
  });
});

describe('effectiveWindow', () => {
  it('resets a passed window', () => {
    expect(effectiveWindow({ pct: 73, resetsAt: at(-MIN) }, now)).toEqual({ pct: 0, resetsAt: null });
    expect(effectiveWindow({ pct: 73, resetsAt: now }, now)).toEqual({ pct: 0, resetsAt: null });
  });
  it('keeps a future window', () => {
    const window = { pct: 73, resetsAt: at(MIN) };
    expect(effectiveWindow(window, now)).toBe(window);
    const open = { pct: 10, resetsAt: null };
    expect(effectiveWindow(open, now)).toBe(open);
  });
});

describe('staleLabel', () => {
  const fetchedAt = new Date('2026-11-14T01:12:00Z');
  it('is null under 3 minutes', () => {
    expect(staleLabel(fetchedAt, new Date(fetchedAt.getTime() + 2 * MIN + 59_000), 'UTC')).toBeNull();
  });
  it('formats in the settings time zone', () => {
    const later = new Date(fetchedAt.getTime() + 3 * MIN);
    expect(staleLabel(fetchedAt, later, 'Europe/London')).toBe('as of 01:12');
    expect(staleLabel(fetchedAt, later, 'Africa/Johannesburg')).toBe('as of 03:12');
  });
});
