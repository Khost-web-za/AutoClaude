import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { runResumeJob, type ResumeJobDeps } from '@/auto-resume/resume-job';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { repoSettings, sessionEvents, sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { readResumeMessages } from '@/repos/repo-settings-store';
import { restartSession } from '@/sessions/start-session';
import { stopSession } from '@/sessions/stop-session';
import type { UsageResult } from '@/usage/usage-client';
import { testDeps } from '../sessions/session-test-deps';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../fixtures/limit-screens', `${name}.txt`), 'utf8').replace(/^# synthetic[^\n]*\n/, '');

const NOW = new Date('2026-11-14T10:00:00Z');
const RESET = new Date('2026-11-14T15:00:00Z');
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

const usage = (fiveHourPct: number, resetsAt: Date | null = RESET): UsageResult => ({
  snapshot: { fiveHour: { pct: fiveHourPct, resetsAt }, weekly: { pct: 10, resetsAt: null }, extra: [], fetchedAt: NOW },
  stale: false,
  reason: null,
});

function setup(db: Db, overrides: Partial<ResumeJobDeps> = {}) {
  return {
    db,
    capturePane: vi.fn(async () => fixture('empty-prompt')),
    typeIntoClaude: vi.fn(async () => {}),
    requestRelaunch: vi.fn(async () => {}),
    getUsage: vi.fn(async () => usage(20)),
    publish: vi.fn(),
    resumeMessagesFor: vi.fn(async (repos: string[]) => new Map(repos.map((repo) => [repo, 'Please continue where you left off.']))),
    containerTimeZone: 'UTC',
    ...overrides,
  } satisfies ResumeJobDeps;
}

let seq = 0;
async function seed(db: Db, values: Partial<typeof sessions.$inferInsert> = {}) {
  seq += 1;
  const [row] = await db
    .insert(sessions)
    .values({
      repoFullName: 'acme/widgets',
      baseBranch: 'main',
      workBranch: `claude/x-${seq}`,
      defaultBranch: 'main',
      secretHash: 'hash',
      status: 'working',
      containerId: `container-${seq}`,
      autoResume: true,
      ...values,
    })
    .returning();
  return row!;
}

const load = async (db: Db, id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]!;

/** A session waiting out a limit that reset at RESET, its step `attempts` due. */
const waiting = (attempts: number, nextAt: Date) => ({
  limitState: attempts === 0 ? ('limited' as const) : ('resuming' as const),
  limitResetsAt: RESET,
  resumeAttempts: attempts,
  resumeNextAt: nextAt,
});

describe('auto-resume job', () => {
  it('marks a session limited from the screen', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db);
      const deps = setup(db, { capturePane: vi.fn(async () => fixture('limit-5-hour')), getUsage: async () => usage(80, null) });
      await runResumeJob(deps, NOW);
      const after = await load(db, row.id);
      expect(after.limitState).toBe('limited');
      expect(after.limitResetsAt).toEqual(RESET);
      expect(after.resumeNextAt).toEqual(plus(RESET, 1));
      expect(after.resumeAttempts).toBe(0);
      expect(deps.capturePane).toHaveBeenCalledWith(row.containerId);
      expect(deps.publish).toHaveBeenCalledWith({
        kind: 'session_limit',
        sessionId: row.id,
        limitState: 'limited',
        resumeAt: plus(RESET, 1).toISOString(),
        detail: null,
      });
    }));

  it('never marks a session limited from replies or tool output that mention a limit', () =>
    withTestDb(async ({ db }) => {
      const reply = await seed(db);
      const tool = await seed(db);
      const panes: Record<string, string> = {
        [reply.containerId!]: fixture('assistant-mentions-usage-limit'),
        [tool.containerId!]: fixture('tool-output-rate-limit'),
      };
      const deps = setup(db, { capturePane: vi.fn(async (id: string) => panes[id]!), getUsage: async () => usage(80, null) });
      await runResumeJob(deps, NOW);
      expect((await load(db, reply.id)).limitState).toBe('none');
      expect((await load(db, tool.id)).limitState).toBe('none');
      expect(deps.publish).not.toHaveBeenCalled();
    }));

  it('prefers the usage reset and falls back to 15 minutes when nothing says', () =>
    withTestDb(async ({ db }) => {
      const usageReset = plus(RESET, 30);
      const fromUsage = await seed(db, { status: 'idle' });
      await runResumeJob(setup(db, { getUsage: async () => usage(100, usageReset) }), NOW);
      expect((await load(db, fromUsage.id)).limitResetsAt).toEqual(usageReset);

      const unknown = await seed(db);
      const capturePane = vi.fn(async () => fixture('limit-5-hour').replace('resets 3pm', 'resets Monday'));
      await runResumeJob(setup(db, { capturePane, getUsage: async () => ({ snapshot: null, stale: true, reason: 'unavailable' }) }), NOW);
      const after = await load(db, unknown.id);
      expect(after.limitState).toBe('limited');
      expect(after.limitResetsAt).toEqual(plus(NOW, 15));
    }));

  it('marks limited from usage only when idle or quiet for 2 minutes', () =>
    withTestDb(async ({ db }) => {
      const busy = await seed(db);
      const quiet = await seed(db);
      const idle = await seed(db, { status: 'idle' });
      const silent = await seed(db);
      const off = await seed(db, { status: 'idle', autoResume: false });
      await db.insert(sessionEvents).values([
        { sessionId: busy.id, type: 'hook', at: plus(NOW, -1) },
        { sessionId: quiet.id, type: 'hook', at: plus(NOW, -10) },
        { sessionId: quiet.id, type: 'hook', at: plus(NOW, -3) },
        { sessionId: idle.id, type: 'hook', at: plus(NOW, -0.5) },
      ]);
      await runResumeJob(setup(db, { getUsage: async () => usage(100) }), NOW);
      expect((await load(db, busy.id)).limitState).toBe('none');
      expect((await load(db, quiet.id)).limitState).toBe('limited');
      expect((await load(db, idle.id)).limitState).toBe('limited');
      expect((await load(db, silent.id)).limitState).toBe('limited');
      expect((await load(db, off.id)).limitState).toBe('none');
    }));

  it('one events query for all candidates', () =>
    withTestDb(async ({ db, url }) => {
      const ids = await Promise.all([seed(db), seed(db), seed(db)]);
      await db.insert(sessionEvents).values(ids.map((row) => ({ sessionId: row.id, type: 'hook', at: plus(NOW, -1) })));
      const queries: string[] = [];
      const client = postgres(url, { max: 2, onnotice: () => {} });
      try {
        const logged = drizzle({ client, schema, casing: 'snake_case', logger: { logQuery: (query) => queries.push(query) } });
        const deps = setup(logged, { getUsage: async () => usage(100) });
        await runResumeJob(deps, NOW);
        expect(deps.capturePane).toHaveBeenCalledTimes(3);
      } finally {
        await client.end();
      }
      expect(queries.filter((query) => query.includes('"session_events"'))).toHaveLength(1);
    }));

  it('captures at most 4 panes at once', () =>
    withTestDb(async ({ db }) => {
      await Promise.all(Array.from({ length: 7 }, () => seed(db)));
      let active = 0;
      let peak = 0;
      const capturePane = vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return fixture('empty-prompt');
      });
      await runResumeJob(setup(db, { capturePane }), NOW);
      expect(capturePane).toHaveBeenCalledTimes(7);
      expect(peak).toBe(4);
    }));

  it('claim is exclusive', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const deps = setup(db);
      const now = plus(RESET, 1);
      await Promise.all([runResumeJob(deps, now), runResumeJob(deps, now), runResumeJob(deps, now)]);
      expect(deps.typeIntoClaude).toHaveBeenCalledTimes(1);
      expect((await load(db, row.id)).resumeAttempts).toBe(1);
    }));

  it("types the repo's message, without Escape at the prompt", () =>
    withTestDb(async ({ db }) => {
      await db.insert(repoSettings).values({ repoFullName: 'acme/widgets', resumeMessage: 'Keep going, please.' });
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const other = await seed(db, { ...waiting(0, plus(RESET, 1)), repoFullName: 'acme/gadgets' });
      const resumeMessagesFor = vi.fn((repos: string[]) => readResumeMessages(repos, db));
      // The limit line is still on screen at reset+1: `resets 3pm` now reads as tomorrow and must not re-wait.
      const deps = setup(db, { resumeMessagesFor, capturePane: vi.fn(async () => fixture('limit-5-hour')) });
      await runResumeJob(deps, plus(RESET, 1));
      expect(resumeMessagesFor).toHaveBeenCalledTimes(1);
      expect(deps.typeIntoClaude).toHaveBeenCalledWith(other.containerId, 'Please continue where you left off.', { escapeFirst: false });
      expect(deps.typeIntoClaude).toHaveBeenCalledWith(row.containerId, 'Keep going, please.', { escapeFirst: false });
      const after = await load(db, row.id);
      expect(after.limitState).toBe('resuming');
      expect(after.resumeAttempts).toBe(1);
      expect(after.resumeNextAt).toEqual(plus(RESET, 6));
      expect(deps.publish).toHaveBeenCalledWith({
        kind: 'session_limit',
        sessionId: row.id,
        limitState: 'resuming',
        resumeAt: plus(RESET, 6).toISOString(),
        detail: null,
      });
    }));

  it('presses Escape first only to close the limit menu', () =>
    withTestDb(async ({ db }) => {
      await seed(db, waiting(0, plus(RESET, 1)));
      const deps = setup(db, { capturePane: vi.fn(async () => fixture('limit-options-menu')) });
      await runResumeJob(deps, plus(RESET, 1));
      expect(deps.typeIntoClaude).toHaveBeenCalledWith(expect.any(String), 'Please continue where you left off.', { escapeFirst: true });
    }));

  it('never types over a draft in the prompt', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const draft = fixture('limit-5-hour').replace(/^> $/m, '> half a thought');
      const deps = setup(db, { capturePane: vi.fn(async () => draft) });
      await runResumeJob(deps, plus(RESET, 1));
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      expect((await load(db, row.id)).limitDetail).toBe('Waiting: the prompt has unsent text');
    }));

  it('leaves a step that is not yet due', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const deps = setup(db);
      await runResumeJob(deps, RESET);
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      expect((await load(db, row.id)).resumeNextAt).toEqual(plus(RESET, 1));
    }));

  it('never types over a permission prompt', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const deps = setup(db, { capturePane: vi.fn(async () => fixture('permission-prompt')) });
      await runResumeJob(deps, plus(RESET, 1));
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      const after = await load(db, row.id);
      expect(after.limitDetail).toBe('Waiting: Claude is asking something');
      expect(after.resumeAttempts).toBe(1);
      expect(after.resumeNextAt).toEqual(plus(RESET, 6));
    }));

  it('re-checks and re-waits when weekly is at 100', () =>
    withTestDb(async ({ db }) => {
      const weeklyReset = new Date('2026-11-17T09:00:00Z');
      const row = await seed(db, waiting(1, plus(RESET, 6)));
      const getUsage = async (): Promise<UsageResult> => ({
        snapshot: { fiveHour: { pct: 0, resetsAt: null }, weekly: { pct: 100, resetsAt: weeklyReset }, extra: [], fetchedAt: NOW },
        stale: false,
        reason: null,
      });
      const deps = setup(db, { getUsage });
      await runResumeJob(deps, plus(RESET, 6));
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      const after = await load(db, row.id);
      expect(after.limitState).toBe('limited');
      expect(after.limitResetsAt).toEqual(weeklyReset);
      expect(after.resumeNextAt).toEqual(plus(weeklyReset, 1));
      expect(after.resumeAttempts).toBe(0);
    }));

  it('continues from the stored attempt after restart', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(2, plus(RESET, 16)));
      const deps = setup(db);
      await runResumeJob(deps, plus(RESET, 16));
      expect(deps.typeIntoClaude).toHaveBeenCalledTimes(1);
      let after = await load(db, row.id);
      expect(after.resumeAttempts).toBe(3);
      expect(after.resumeNextAt).toEqual(plus(RESET, 18));

      await runResumeJob(deps, plus(RESET, 18));
      expect(deps.requestRelaunch).toHaveBeenCalledWith(row.containerId, 'Please continue where you left off.');
      after = await load(db, row.id);
      expect(after.limitState).toBe('resuming');
      expect(after.resumeAttempts).toBe(4);
      expect(after.resumeNextAt).toEqual(plus(RESET, 21));

      await runResumeJob(deps, plus(RESET, 21));
      after = await load(db, row.id);
      expect(after.limitState).toBe('failed');
      expect(after.limitDetail).toBe('Resume failed: no response after relaunch');
      expect(after.resumeNextAt).toBeNull();
      expect(deps.typeIntoClaude).toHaveBeenCalledTimes(1);
      expect(deps.requestRelaunch).toHaveBeenCalledTimes(1);
    }));

  it('relaunches when Claude is not running', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const deps = setup(db, { capturePane: vi.fn(async () => Promise.reject(new Error("can't find session: claude"))) });
      await runResumeJob(deps, plus(RESET, 1));
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      expect(deps.requestRelaunch).toHaveBeenCalledTimes(1);
      const after = await load(db, row.id);
      expect(after.resumeNextAt).toEqual(plus(RESET, 21));
      expect(after.resumeAttempts).toBe(4);

      await runResumeJob(deps, plus(RESET, 21));
      expect((await load(db, row.id)).limitState).toBe('failed');
      expect(deps.requestRelaunch).toHaveBeenCalledTimes(1);
    }));

  it('schedules a late step from now, not in the past', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(1, plus(RESET, 6)));
      const now = plus(RESET, 30);
      await runResumeJob(setup(db), now);
      const after = await load(db, row.id);
      expect(after.resumeAttempts).toBe(2);
      expect(after.resumeNextAt).toEqual(plus(now, 2));
    }));

  it('does not trust an old limit line re-read just after its reset', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db);
      const now = plus(RESET, 1);
      const deps = setup(db, { capturePane: vi.fn(async () => fixture('limit-5-hour')), getUsage: async () => usage(30, null) });
      await runResumeJob(deps, now);
      const after = await load(db, row.id);
      expect(after.limitState).toBe('limited');
      expect(after.limitResetsAt).toEqual(plus(now, 15));
    }));

  it('a stop forgets the limit, so a restarted session is never typed into', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, { ...waiting(1, plus(RESET, 6)), limitDetail: 'Waiting: Claude is asking something' });
      const published: unknown[] = [];
      const sessionDeps = testDeps(db, { eventBus: { publish: (event) => void published.push(event) } });
      await stopSession(row.id, sessionDeps);
      expect(await load(db, row.id)).toMatchObject({
        status: 'stopped',
        limitState: 'none',
        resumeAttempts: 0,
        limitResetsAt: null,
        resumeNextAt: null,
        limitDetail: null,
      });
      expect(published).toContainEqual({ kind: 'session_limit', sessionId: row.id, limitState: 'none', resumeAt: null, detail: null });

      await restartSession(row.id, sessionDeps);
      await db.update(sessions).set({ status: 'working' }).where(eq(sessions.id, row.id)); // the runner's SessionStart
      const deps = setup(db);
      await runResumeJob(deps, plus(RESET, 60));
      expect(deps.typeIntoClaude).not.toHaveBeenCalled();
      expect(deps.requestRelaunch).not.toHaveBeenCalled();
      expect((await load(db, row.id)).limitState).toBe('none');
    }));

  it('a restart forgets a limit left from before (a crash)', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, { status: 'failed', limitState: 'failed', limitDetail: 'Resume failed: Claude crashed' });
      const published: unknown[] = [];
      await restartSession(row.id, testDeps(db, { eventBus: { publish: (event) => void published.push(event) } }));
      expect(await load(db, row.id)).toMatchObject({ status: 'starting', limitState: 'none', limitDetail: null });
      expect(published).toContainEqual({ kind: 'session_limit', sessionId: row.id, limitState: 'none', resumeAt: null, detail: null });
    }));

  it('keeps a limit a prompt cleared while the message was being typed', () =>
    withTestDb(async ({ db }) => {
      const row = await seed(db, waiting(0, plus(RESET, 1)));
      const typeIntoClaude = vi.fn(async () => {
        // What the runner API does when UserPromptSubmit arrives.
        await db
          .update(sessions)
          .set({ limitState: 'none', resumeAttempts: 0, limitResetsAt: null, resumeNextAt: null, limitDetail: null })
          .where(eq(sessions.id, row.id));
      });
      const deps = setup(db, { typeIntoClaude });
      await runResumeJob(deps, plus(RESET, 1));
      const after = await load(db, row.id);
      expect(after.limitState).toBe('none');
      expect(after.resumeNextAt).toBeNull();
      expect(deps.publish).not.toHaveBeenCalled();
    }));
});
