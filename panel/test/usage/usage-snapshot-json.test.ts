import { describe, expect, it } from 'vitest';
import { reviveSnapshot } from '@/usage/usage-snapshot-json';
import type { UsageSnapshot } from '@/usage/usage-types';

const snapshot: UsageSnapshot = {
  fiveHour: { pct: 42, resetsAt: new Date('2026-11-15T03:00:00Z') },
  weekly: { pct: 7, resetsAt: null },
  extra: [{ label: 'Opus', pct: 10, resetsAt: new Date('2026-11-17T09:00:00Z') }],
  fetchedAt: new Date('2026-11-14T22:00:00Z'),
};

describe('reviveSnapshot', () => {
  it('restores the dates JSON turned into strings', () => {
    expect(reviveSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('answers null for nothing or a shape it does not know', () => {
    expect(reviveSnapshot(null)).toBeNull();
    expect(reviveSnapshot({ fiveHour: { pct: 1, resetsAt: null } })).toBeNull();
    expect(reviveSnapshot({ ...JSON.parse(JSON.stringify(snapshot)), extra: 'none' })).toBeNull();
  });

  it('answers null for an unreadable fetch time', () => {
    expect(reviveSnapshot({ ...JSON.parse(JSON.stringify(snapshot)), fetchedAt: 'yesterday' })).toBeNull();
  });
});
