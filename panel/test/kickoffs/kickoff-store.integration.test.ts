import { describe, expect, it } from 'vitest';
import { windowKickoffs } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import {
  addKickoff,
  claimDueKickoffs,
  failInterrupted,
  finishKickoff,
  KickoffLimitError,
  listHistory,
  listUpcoming,
  removeKickoff,
  rescheduleKickoff,
} from '@/kickoffs/kickoff-store';

const at = (iso: string) => new Date(iso);

describe('kick-off store', () => {
  it('lists upcoming soonest first', () =>
    withTestDb(async ({ db }) => {
      await addKickoff(db, at('2026-11-16T10:00:00Z'));
      await addKickoff(db, at('2026-11-15T10:00:00Z'));
      const upcoming = await listUpcoming(db);
      expect(upcoming.map((r) => r.runAt.toISOString())).toEqual(['2026-11-15T10:00:00.000Z', '2026-11-16T10:00:00.000Z']);
    }));

  it('claim is exclusive', () =>
    withTestDb(async ({ db }) => {
      for (const iso of ['2026-11-14T10:00:00Z', '2026-11-14T11:00:00Z', '2026-11-14T12:00:00Z']) {
        await addKickoff(db, at(iso));
      }
      await addKickoff(db, at('2026-11-20T10:00:00Z'));
      const now = at('2026-11-14T13:00:00Z');
      const [a, b] = await Promise.all([claimDueKickoffs(db, now), claimDueKickoffs(db, now)]);
      const ids = [...a, ...b].map((r) => r.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect([...a, ...b].every((r) => r.status === 'running')).toBe(true);
      expect(await listUpcoming(db)).toHaveLength(1);
    }));

  it('reschedule and remove ignore finished rows', () =>
    withTestDb(async ({ db }) => {
      const done = await addKickoff(db, at('2026-11-14T10:00:00Z'));
      await claimDueKickoffs(db, at('2026-11-14T11:00:00Z'));
      await finishKickoff(db, done.id, { status: 'started', outcome: 'Window started' });
      expect(await rescheduleKickoff(db, done.id, at('2026-11-18T10:00:00Z'))).toBe(false);
      expect(await removeKickoff(db, done.id)).toBe(false);

      const pending = await addKickoff(db, at('2026-11-17T10:00:00Z'));
      expect(await rescheduleKickoff(db, pending.id, at('2026-11-18T10:00:00Z'))).toBe(true);
      expect((await listUpcoming(db))[0]?.runAt.toISOString()).toBe('2026-11-18T10:00:00.000Z');
      expect(await removeKickoff(db, pending.id)).toBe(true);
      expect(await listUpcoming(db)).toEqual([]);
    }));

  it('rejects the 21st upcoming', () =>
    withTestDb(async ({ db }) => {
      for (let i = 0; i < 20; i++) await addKickoff(db, at(`2026-11-15T${String(i).padStart(2, '0')}:00:00Z`));
      await expect(addKickoff(db, at('2026-11-16T00:00:00Z'))).rejects.toBeInstanceOf(KickoffLimitError);
      expect(await listUpcoming(db)).toHaveLength(20);
    }));

  it('history pages newest first and leaves out scheduled rows', () =>
    withTestDb(async ({ db }) => {
      await db.insert(windowKickoffs).values(
        Array.from({ length: 25 }, (_, i) => ({
          runAt: new Date(Date.UTC(2026, 10, 1, i)),
          status: 'started' as const,
        })),
      );
      await addKickoff(db, at('2026-12-01T00:00:00Z'));
      const first = await listHistory(db, 1);
      expect(first.total).toBe(25);
      expect(first.items).toHaveLength(20);
      expect(first.items[0]?.runAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
      const second = await listHistory(db, 2);
      expect(second.items).toHaveLength(5);
      expect(second.items[4]?.runAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    }));

  it('marks an interrupted running kick-off failed', () =>
    withTestDb(async ({ db }) => {
      const stale = await addKickoff(db, at('2026-11-14T10:00:00Z'));
      await claimDueKickoffs(db, at('2026-11-14T10:00:00Z'));
      const recent = await addKickoff(db, at('2026-11-14T10:58:00Z'));
      await claimDueKickoffs(db, at('2026-11-14T10:58:00Z'));
      expect(await failInterrupted(db, at('2026-11-14T11:00:00Z'))).toBe(1);
      const { items } = await listHistory(db, 1);
      const byId = new Map(items.map((r) => [r.id, r]));
      expect(byId.get(stale.id)).toMatchObject({ status: 'failed', outcome: 'Interrupted: the panel restarted' });
      expect(byId.get(stale.id)?.finishedAt).not.toBeNull();
      expect(byId.get(recent.id)?.status).toBe('running');
    }));

  it('times an interruption from the claim, not from run_at: a late catch-up is not failed as it starts', () =>
    withTestDb(async ({ db }) => {
      const late = await addKickoff(db, at('2026-11-14T10:30:00Z'));
      const [claimed] = await claimDueKickoffs(db, at('2026-11-14T10:55:00Z'));
      expect(claimed?.claimedAt).toEqual(at('2026-11-14T10:55:00Z'));
      expect(await failInterrupted(db, at('2026-11-14T10:56:00Z'))).toBe(0);
      expect(await failInterrupted(db, at('2026-11-14T11:01:00Z'))).toBe(1);
      const { items } = await listHistory(db, 1);
      expect(items.find((r) => r.id === late.id)?.status).toBe('failed');
    }));

  it('finishes only a running kick-off', () =>
    withTestDb(async ({ db }) => {
      const scheduled = await addKickoff(db, at('2026-11-15T10:00:00Z'));
      await finishKickoff(db, scheduled.id, { status: 'started', outcome: 'Window started' });
      expect((await listUpcoming(db)).map((r) => r.id)).toEqual([scheduled.id]);

      const interrupted = await addKickoff(db, at('2026-11-14T10:00:00Z'));
      await claimDueKickoffs(db, at('2026-11-14T10:00:00Z'));
      await failInterrupted(db, at('2026-11-14T10:10:00Z'));
      await finishKickoff(db, interrupted.id, { status: 'started', outcome: 'Window started' });
      const { items } = await listHistory(db, 1);
      expect(items.find((r) => r.id === interrupted.id)).toMatchObject({
        status: 'failed',
        outcome: 'Interrupted: the panel restarted',
      });
    }));
});
