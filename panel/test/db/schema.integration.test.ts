import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { paginate } from '@/db/pagination';
import { sessionEvents, sessionProfiles, sessions, settings, usageCache } from '@/db/schema';
import { withTestDb } from '@/db/testing';

const baseSession = {
  repoFullName: 'acme/widgets',
  baseBranch: 'main',
  workBranch: 'claude/session-abcd',
  defaultBranch: 'main',
  secretHash: 'hash',
};

describe('database schema', () => {
  it('applies migrations on an empty database and seeds the settings row', () =>
    withTestDb(async ({ db }) => {
      const rows = await db.select().from(settings);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 1,
        maxRunning: 3,
        cpuPerSession: 4,
        memoryGbPerSession: 8,
        diskGbPerSession: 40,
        minFreeDiskGb: 10,
        usageResetDisplay: 'countdown',
        usageWarnPct: 80,
        usageDangerPct: 95,
      });
    }));

  it('rejects a second settings row', () =>
    withTestDb(async ({ db }) => {
      const error = await db
        .insert(settings)
        .values({
          id: 2,
          maxRunning: 1,
          cpuPerSession: 1,
          memoryGbPerSession: 1,
          diskGbPerSession: 1,
          minFreeDiskGb: 1,
          usageResetDisplay: 'clock',
          usageWarnPct: 1,
          usageDangerPct: 2,
          timeZone: 'UTC',
        })
        .then(
          () => null,
          (e: { cause?: { code?: string } }) => e,
        );
      expect(error?.cause?.code).toBe('23514');
    }));

  it('keeps a single usage_cache row', () =>
    withTestDb(async ({ db }) => {
      const values = { snapshot: { fiveHour: { pct: 1, resetsAt: null } }, fetchedAt: new Date() };
      await db.insert(usageCache).values(values);
      const error = await db
        .insert(usageCache)
        .values({ ...values, id: 2 })
        .then(
          () => null,
          (e: { cause?: { code?: string } }) => e,
        );
      expect(error?.cause?.code).toBe('23514');
    }));

  it('cascades session deletion to events and profiles', () =>
    withTestDb(async ({ db }) => {
      const [session] = await db.insert(sessions).values(baseSession).returning();
      await db.insert(sessionEvents).values({ sessionId: session!.id, type: 'status', data: { to: 'working' } });
      await db.insert(sessionProfiles).values({ sessionId: session!.id, profile: 'base', position: 0 });

      await db.delete(sessions).where(eq(sessions.id, session!.id));

      expect(await db.select().from(sessionEvents)).toHaveLength(0);
      expect(await db.select().from(sessionProfiles)).toHaveLength(0);
    }));

  describe('one live push session per branch', () => {
    const push = { ...baseSession, deliveryMode: 'push' as const };
    const code = (e: { cause?: { code?: string } }) => e.cause?.code;

    it('rejects a second live push session on one branch', () =>
      withTestDb(async ({ db }) => {
        await db.insert(sessions).values({ ...push, status: 'working' });
        const error = await db
          .insert(sessions)
          .values({ ...push, status: 'working' })
          .then(
            () => null,
            (e: { cause?: { code?: string } }) => e,
          );
        expect(error && code(error)).toBe('23505');
      }));

    it('allows it once the first is stopped', () =>
      withTestDb(async ({ db }) => {
        await db.insert(sessions).values({ ...push, status: 'stopped' });
        await expect(db.insert(sessions).values({ ...push, status: 'working' })).resolves.toBeDefined();
      }));

    it('does not constrain pull_request sessions', () =>
      withTestDb(async ({ db }) => {
        await db.insert(sessions).values({ ...baseSession, status: 'working' });
        await expect(db.insert(sessions).values({ ...baseSession, status: 'working' })).resolves.toBeDefined();
      }));
  });
});

describe('paginate', () => {
  const seed = (db: Db, count: number) =>
    db.insert(sessions).values(
      Array.from({ length: count }, (_, i) => ({
        ...baseSession,
        workBranch: `claude/session-${String(i).padStart(2, '0')}`,
      })),
    );
  const query = (db: Db) => () => db.select().from(sessions).orderBy(sessions.workBranch).$dynamic();

  it('paginates 45 sessions: page 3 has 5 items, in order', () =>
    withTestDb(async ({ db }) => {
      await seed(db, 45);
      const result = await paginate(db, query(db), { page: 3 });
      expect(result).toMatchObject({ page: 3, pageSize: 20, total: 45, pageCount: 3 });
      expect(result.items.map((s) => s.workBranch)).toEqual(
        [40, 41, 42, 43, 44].map((i) => `claude/session-${i}`),
      );
    }));

  it('falls back to the last page when the page is past the end', () =>
    withTestDb(async ({ db }) => {
      await seed(db, 45);
      const result = await paginate(db, query(db), { page: 999 });
      expect(result).toMatchObject({ page: 3, total: 45, pageCount: 3 });
      expect(result.items).toHaveLength(5);
    }));

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1.9])('sanitises page %s', (page) =>
    withTestDb(async ({ db }) => {
      await seed(db, 25);
      const result = await paginate(db, query(db), { page });
      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(20);
    }));

  it('returns one empty page for zero rows', () =>
    withTestDb(async ({ db }) => {
      const result = await paginate(db, query(db), { page: 5 });
      expect(result).toEqual({ items: [], page: 1, pageSize: 20, total: 0, pageCount: 1 });
    }));
});
