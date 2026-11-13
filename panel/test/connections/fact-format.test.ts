import { describe, expect, it } from 'vitest';
import { formatWhen } from '@/connections/fact-format';

const NOW = new Date('2026-11-13T12:00:00Z');

describe('formatWhen', () => {
  it('prints the time in the zone with a relative hint', () => {
    expect(formatWhen(new Date('2026-11-13T09:00:00Z'), NOW, 'Europe/Berlin')).toBe('Nov 13, 10:00 AM (3 hours ago)');
    expect(formatWhen(new Date('2026-11-14T12:00:00Z'), NOW, 'UTC')).toBe('Nov 14, 12:00 PM (tomorrow)');
    expect(formatWhen(new Date('2026-11-13T12:20:00Z'), NOW, 'UTC')).toBe('Nov 13, 12:20 PM (in 20 minutes)');
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(formatWhen(new Date('2026-11-13T09:00:00Z'), NOW, 'Nowhere/Else')).toBe('Nov 13, 9:00 AM (3 hours ago)');
  });
});
