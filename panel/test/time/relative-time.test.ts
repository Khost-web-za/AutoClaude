import { describe, expect, it } from 'vitest';
import { formatAge, formatAgo, formatRelative } from '@/time/relative-time';

const NOW = new Date('2026-11-13T12:00:00Z');
const before = (ms: number) => new Date(NOW.getTime() - ms);

describe('formatAgo', () => {
  it.each([
    [before(10_000), 'just now'],
    [before(5 * 60_000), '5m ago'],
    [before(2 * 3_600_000), '2h ago'],
    [before(3 * 86_400_000), '3d ago'],
    [before(45 * 86_400_000), '45d ago'],
    [new Date(NOW.getTime() + 60_000), 'just now'],
  ])('%s → %s', (date, expected) => {
    expect(formatAgo(date, NOW)).toBe(expected);
  });
});

describe('formatAge', () => {
  it.each([
    [before(10_000), '<1m'],
    [before(38 * 60_000), '38m'],
    [before(2 * 3_600_000 + 59 * 60_000), '2h'],
    [before(3 * 86_400_000), '3d'],
  ])('%s → %s', (date, expected) => {
    expect(formatAge(date, NOW)).toBe(expected);
  });
});

describe('formatRelative', () => {
  it('reads both directions in words', () => {
    expect(formatRelative(before(3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(formatRelative(new Date(NOW.getTime() + 20 * 60_000), NOW)).toBe('in 20 minutes');
    expect(formatRelative(new Date(NOW.getTime() + 86_400_000), NOW)).toBe('tomorrow');
    expect(formatRelative(before(5_000), NOW)).toBe('just now');
  });
});
