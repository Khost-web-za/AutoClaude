import { describe, expect, it } from 'vitest';
import { kickoffInputSchema, validateRunAt } from '@/kickoffs/kickoff-schemas';

const now = new Date('2026-11-14T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe('kickoffInputSchema', () => {
  it('accepts YYYY-MM-DDTHH:mm', () => {
    expect(kickoffInputSchema.safeParse({ runAtLocal: '2026-11-15T04:00' }).success).toBe(true);
    expect(kickoffInputSchema.safeParse({ runAtLocal: '2028-02-29T10:00' }).success).toBe(true);
  });

  it('rejects malformed values', () => {
    for (const runAtLocal of ['', 'tomorrow', '2026-11-15 04:00', '2026-11-15T04:00:00Z', '2026-13-45T99:99', '2026-02-31T10:00', '2026-11-14T24:00', '2027-02-29T10:00', '2026-00-10T10:00']) {
      expect(kickoffInputSchema.safeParse({ runAtLocal }).success).toBe(false);
    }
    expect(kickoffInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('validateRunAt', () => {
  it('accepts a time inside the window, and 60 s of slack in the past', () => {
    expect(validateRunAt(minutes(30), now)).toBeNull();
    expect(validateRunAt(new Date(now.getTime() - 59_000), now)).toBeNull();
  });

  it('rejects the past', () => {
    expect(validateRunAt(new Date(now.getTime() - 61_000), now)).toBe('Pick a time in the future.');
  });

  it('rejects more than 7 days ahead', () => {
    expect(validateRunAt(minutes(7 * 24 * 60), now)).toBeNull();
    expect(validateRunAt(minutes(7 * 24 * 60 + 1), now)).toBe('Pick a time within the next 7 days.');
  });
});
