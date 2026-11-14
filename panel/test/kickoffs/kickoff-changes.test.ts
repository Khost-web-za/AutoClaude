import { describe, expect, it } from 'vitest';
import { applyKickoffChange, pendingKickoff } from '@/kickoffs/kickoff-changes';
import type { KickoffView } from '@/kickoffs/kickoff-view';

const row = (id: string, runAt: string): KickoffView => ({ id, runAt, status: 'scheduled', outcome: null });
const rows = [row('a', '2026-11-15T04:00:00.000Z'), row('b', '2026-11-16T04:00:00.000Z')];

describe('applyKickoffChange', () => {
  it('adds a pending row in time order', () => {
    const added = pendingKickoff('pending-1', new Date('2026-11-15T12:00:00Z'));
    expect(applyKickoffChange(rows, { type: 'add', row: added }).map((r) => r.id)).toEqual(['a', 'pending-1', 'b']);
    expect(added).toEqual({ id: 'pending-1', runAt: '2026-11-15T12:00:00.000Z', status: 'scheduled', outcome: null, pending: true });
  });

  it('removes a row', () => {
    expect(applyKickoffChange(rows, { type: 'remove', id: 'a' })).toEqual([rows[1]]);
  });

  it('moves a row and keeps time order', () => {
    const moved = applyKickoffChange(rows, { type: 'move', id: 'a', runAt: '2026-11-17T04:00:00.000Z' });
    expect(moved.map((r) => [r.id, r.runAt])).toEqual([
      ['b', '2026-11-16T04:00:00.000Z'],
      ['a', '2026-11-17T04:00:00.000Z'],
    ]);
  });
});
