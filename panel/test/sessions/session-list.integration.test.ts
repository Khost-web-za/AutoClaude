import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { sessionEvents, sessions, type SessionStatus } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { listSessionEvents, listRecentEvents, loadSessionView } from '@/sessions/session-detail';
import { countSessionTabs, listSessions } from '@/sessions/session-list';

async function seed(db: Db, rows: { status: SessionStatus; repo?: string; task?: string | null; deleted?: boolean }[]) {
  const values = rows.map((row, i) => ({
    repoFullName: row.repo ?? 'Acme/Widgets',
    baseBranch: 'main',
    workBranch: `claude/s-${i}`,
    defaultBranch: 'main',
    startingTask: row.task === undefined ? `task ${i}` : row.task,
    status: row.status,
    secretHash: 'h'.repeat(64),
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
    deletedAt: row.deleted ? new Date() : null,
  }));
  return db.insert(sessions).values(values).returning({ id: sessions.id });
}

describe('session list', () => {
  it('counts and filters the tabs, newest first, without deleted rows or the secret hash', () =>
    withTestDb(async ({ db }) => {
      await seed(db, [
        { status: 'starting' },
        { status: 'working' },
        { status: 'waiting' },
        { status: 'idle' },
        { status: 'stopped' },
        { status: 'failed' },
        { status: 'working', deleted: true },
      ]);
      expect(await countSessionTabs('', db)).toEqual({ active: 4, waiting: 2, stopped: 2, all: 6 });
      const waiting = await listSessions({ tab: 'waiting', query: '', page: 1 }, db);
      expect(waiting.items.map((s) => s.status)).toEqual(['idle', 'waiting']);
      const all = await listSessions({ tab: 'all', query: '', page: 1 }, db);
      expect(all.total).toBe(6);
      expect(all.items[0]?.startingTask).toBe('task 5');
      expect(Object.keys(all.items[0]!)).not.toContain('secretHash');
    }));

  it('q matches the repository or the starting task, case-insensitively, with LIKE characters literal', () =>
    withTestDb(async ({ db }) => {
      await seed(db, [
        { status: 'working', repo: 'Acme/Widgets', task: 'Fix the 100% bug' },
        { status: 'working', repo: 'Other/Gadgets', task: 'Port the giveaways page' },
        { status: 'stopped', repo: 'Other/Gadgets', task: null },
      ]);
      expect((await listSessions({ tab: 'all', query: 'widgets', page: 1 }, db)).total).toBe(1);
      expect((await listSessions({ tab: 'all', query: 'GIVEAWAYS', page: 1 }, db)).total).toBe(1);
      expect((await listSessions({ tab: 'all', query: '100%', page: 1 }, db)).total).toBe(1);
      expect((await listSessions({ tab: 'all', query: '%', page: 1 }, db)).total).toBe(1);
      expect(await countSessionTabs('gadgets', db)).toEqual({ active: 1, waiting: 0, stopped: 1, all: 2 });
    }));

  it('shows the time the resume runs (reset + 1 min), not the reset itself, in the list and the detail', () =>
    withTestDb(async ({ db }) => {
      const [row] = await seed(db, [{ status: 'idle' }]);
      const reset = new Date('2026-11-15T03:00:00Z');
      const resumeAt = new Date('2026-11-15T03:01:00Z');
      await db.update(sessions).set({ limitState: 'limited', limitResetsAt: reset, resumeNextAt: resumeAt });
      const list = await listSessions({ tab: 'all', query: '', page: 1 }, db);
      expect(list.items[0]).toMatchObject({ limitState: 'limited', resumeAt });
      expect(await loadSessionView(row!.id, db)).toMatchObject({ limitState: 'limited', resumeAt });
    }));

  it('pages by 20', () =>
    withTestDb(async ({ db }) => {
      await seed(db, Array.from({ length: 23 }, () => ({ status: 'stopped' as const })));
      const second = await listSessions({ tab: 'stopped', query: '', page: 2 }, db);
      expect(second).toMatchObject({ page: 2, pageCount: 2, total: 23 });
      expect(second.items).toHaveLength(3);
    }));
});

describe('session detail', () => {
  it('loads a live session (never the secret hash) and its events newest first, paginated', () =>
    withTestDb(async ({ db }) => {
      const [row] = await seed(db, [{ status: 'working' }]);
      const id = row!.id;
      await db.insert(sessionEvents).values(
        Array.from({ length: 25 }, (_, i) => ({
          sessionId: id,
          type: 'hook',
          data: { event: 'Stop', n: i },
          at: new Date(Date.UTC(2026, 10, 1, 1, i)),
        })),
      );
      const view = await loadSessionView(id, db);
      expect(view?.repoFullName).toBe('Acme/Widgets');
      expect(view).not.toHaveProperty('secretHash');
      expect(await loadSessionView('not-a-uuid', db)).toBeNull();

      const recent = await listRecentEvents(id, db);
      expect(recent.map((e) => e.data.n)).toEqual([24, 23, 22, 21, 20]);
      const page2 = await listSessionEvents(id, 2, db);
      expect(page2).toMatchObject({ total: 25, pageCount: 2 });
      expect(page2.items.map((e) => e.data.n)).toEqual([4, 3, 2, 1, 0]);
    }));
});
