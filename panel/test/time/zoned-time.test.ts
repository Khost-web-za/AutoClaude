import { describe, expect, it } from 'vitest';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';

describe('zoned time', () => {
  it('converts a wall time in Africa/Johannesburg', () => {
    expect(wallTimeToInstant('2026-11-15T04:00', 'Africa/Johannesburg').toISOString()).toBe('2026-11-15T02:00:00.000Z');
  });

  it('converts a wall time across a DST change', () => {
    expect(wallTimeToInstant('2026-03-08T04:00', 'America/New_York').toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(wallTimeToInstant('2026-03-07T04:00', 'America/New_York').toISOString()).toBe('2026-03-07T09:00:00.000Z');
    expect(wallTimeToInstant('2026-11-01T04:00', 'America/New_York').toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });

  it('moves a time inside a spring-forward gap forward by the gap length', () => {
    expect(wallTimeToInstant('2026-03-08T02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(wallTimeToInstant('2026-03-29T02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('takes the first occurrence of a time repeated when clocks go back', () => {
    expect(wallTimeToInstant('2026-11-01T01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('round-trips through instantToWallTime', () => {
    for (const [local, zone] of [
      ['2026-11-15T04:00', 'Africa/Johannesburg'],
      ['2026-03-08T04:00', 'America/New_York'],
      ['2026-11-01T23:59', 'America/New_York'],
      ['2026-07-01T00:00', 'Asia/Kolkata'],
    ] as const) {
      expect(instantToWallTime(wallTimeToInstant(local, zone), zone)).toBe(local);
    }
  });

  it('rejects a malformed wall time', () => {
    expect(() => wallTimeToInstant('2026-11-15 04:00', 'UTC')).toThrow();
  });
});
