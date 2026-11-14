import { describe, expect, it } from 'vitest';
import { formatHourMinute } from '@/time/clock-time';

describe('formatHourMinute', () => {
  const date = new Date('2026-11-14T15:07:00Z');

  it('formats 24 h time in the given zone', () => {
    expect(formatHourMinute(date, 'UTC')).toBe('15:07');
    expect(formatHourMinute(date, 'Asia/Tokyo')).toBe('00:07');
  });

  it('pads midnight hours and falls back to UTC for an unknown zone', () => {
    expect(formatHourMinute(new Date('2026-11-14T00:05:00Z'), 'UTC')).toBe('00:05');
    expect(formatHourMinute(date, 'Not/AZone')).toBe('15:07');
  });
});
