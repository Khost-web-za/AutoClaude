import { describe, expect, it, vi } from 'vitest';
import { windowKickoffs } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { runKickoffJob, type KickoffJobDeps } from '@/kickoffs/kickoff-job';
import type { UsageResult } from '@/usage/usage-client';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-14T10:00:00Z');

const usage = (pct: number, resetsAt: Date | null): UsageResult => ({
  snapshot: {
    fiveHour: { pct, resetsAt },
    weekly: { pct: 0, resetsAt: null },
    extra: [],
    fetchedAt: NOW,
  },
  stale: false,
  reason: null,
});
const unknown: UsageResult = { snapshot: null, stale: true, reason: 'unavailable' };

function setup(db: KickoffJobDeps['db'], overrides: Partial<KickoffJobDeps> = {}) {
  return {
    db,
    runContainer: vi.fn(async () => ({ ok: true }) as const),
    getUsage: vi.fn(async () => usage(0, null)),
    refreshUsage: vi.fn(async () => usage(1, at('2026-11-14T15:00:00Z'))),
    publish: vi.fn(),
    timeZone: async () => 'UTC',
    ...overrides,
  } satisfies KickoffJobDeps;
}

async function seed(db: KickoffJobDeps['db'], ...runAts: string[]) {
  await db.insert(windowKickoffs).values(runAts.map((iso) => ({ runAt: at(iso) })));
}

const rows = (db: KickoffJobDeps['db']) => db.select().from(windowKickoffs).orderBy(windowKickoffs.runAt);

describe('kick-off job', () => {
  it('starts a window and records the refreshed reset', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      const [row] = await rows(db);
      expect(row?.status).toBe('started');
      expect(row?.outcome).toBe('Window started 10:00, resets 15:00');
      expect(row?.windowResetsAt?.toISOString()).toBe('2026-11-14T15:00:00.000Z');
      expect(deps.publish).toHaveBeenCalledWith({ kind: 'kickoffs' });
    }));

  it('records no reset when usage has none', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      await runKickoffJob(setup(db, { refreshUsage: async () => unknown }), NOW);
      const [row] = await rows(db);
      expect(row?.outcome).toBe('Window started 10:00');
      expect(row?.windowResetsAt).toBeNull();
    }));

  it('fails kick-offs more than 30 minutes late as missed', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T09:29:00Z');
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      const [row] = await rows(db);
      expect(row?.status).toBe('failed');
      expect(row?.outcome).toBe('Missed: the panel was down at 09:29');
      expect(deps.runContainer).not.toHaveBeenCalled();
    }));

  it('runs late ones under 30 minutes', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T09:31:00Z');
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      expect((await rows(db))[0]?.status).toBe('started');
      expect(deps.runContainer).toHaveBeenCalledTimes(1);
    }));

  it('skips when a window is already running', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      const deps = setup(db, { getUsage: async () => usage(12, at('2026-11-14T13:30:00Z')) });
      await runKickoffJob(deps, NOW);
      const [row] = await rows(db);
      expect(row?.status).toBe('skipped');
      expect(row?.outcome).toBe('Skipped: window already running, resets 13:30');
      expect(deps.runContainer).not.toHaveBeenCalled();
    }));

  it('runs when the reported window has already rolled over', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      const deps = setup(db, { getUsage: async () => usage(80, at('2026-11-14T09:00:00Z')) });
      await runKickoffJob(deps, NOW);
      expect((await rows(db))[0]?.status).toBe('started');
    }));

  it('fails with the container reason', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      await runKickoffJob(setup(db, { runContainer: async () => ({ ok: false, reason: 'Timed out' }) }), NOW);
      const [row] = await rows(db);
      expect(row?.status).toBe('failed');
      expect(row?.outcome).toBe('Failed: Timed out');
    }));

  it('unknown usage still runs', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T10:00:00Z');
      const deps = setup(db, { getUsage: async () => unknown });
      await runKickoffJob(deps, NOW);
      expect((await rows(db))[0]?.status).toBe('started');
      expect(deps.runContainer).toHaveBeenCalledTimes(1);
    }));

  it('second due kick-off is skipped after the first starts a window', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T09:50:00Z', '2026-11-14T09:55:00Z');
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      const [first, second] = await rows(db);
      expect(first?.status).toBe('started');
      expect(second?.status).toBe('skipped');
      expect(second?.outcome).toBe('Skipped: window already running, resets 15:00');
      expect(deps.runContainer).toHaveBeenCalledTimes(1);
      expect(deps.publish).toHaveBeenCalledTimes(1);
    }));

  it('skips later ones even when refreshed usage is unknown', () =>
    withTestDb(async ({ db }) => {
      await seed(db, '2026-11-14T09:50:00Z', '2026-11-14T09:55:00Z');
      const deps = setup(db, { refreshUsage: async () => unknown });
      await runKickoffJob(deps, NOW);
      const [, second] = await rows(db);
      expect(second?.outcome).toBe('Skipped: window already running');
      expect(deps.runContainer).toHaveBeenCalledTimes(1);
    }));

  it('marks an interrupted running kick-off failed', () =>
    withTestDb(async ({ db }) => {
      await db.insert(windowKickoffs).values({ runAt: at('2026-11-14T09:00:00Z'), status: 'running' });
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      const [row] = await rows(db);
      expect(row?.status).toBe('failed');
      expect(row?.outcome).toBe('Interrupted: the panel restarted');
      expect(deps.publish).toHaveBeenCalledWith({ kind: 'kickoffs' });
    }));

  it('publishes nothing when there is nothing to do', () =>
    withTestDb(async ({ db }) => {
      const deps = setup(db);
      await runKickoffJob(deps, NOW);
      expect(deps.publish).not.toHaveBeenCalled();
    }));
});
