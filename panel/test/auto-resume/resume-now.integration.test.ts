import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ResumeNotApplicableError, resumeNow } from '@/auto-resume/resume-now';
import { sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { SessionNotFoundError } from '@/sessions/session-record';

const base = {
  repoFullName: 'acme/widgets',
  baseBranch: 'main',
  workBranch: 'claude/s-1',
  defaultBranch: 'main',
  secretHash: 'hash',
  containerId: 'abc123',
  status: 'idle' as const,
};

describe('resumeNow', () => {
  it('makes a limited session due so the next tick acts', () =>
    withTestDb(async ({ db }) => {
      const [row] = await db
        .insert(sessions)
        .values({ ...base, limitState: 'limited', limitResetsAt: new Date(Date.now() + 3_600_000), resumeAttempts: 3, resumeNextAt: new Date(Date.now() + 3_600_000) })
        .returning();
      const before = Date.now();
      await resumeNow(row!.id, { db, eventBus: { publish: () => {} } });
      const [after] = await db.select().from(sessions).where(eq(sessions.id, row!.id));
      expect(after).toMatchObject({ limitState: 'limited', resumeAttempts: 0 });
      expect(after!.resumeNextAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(after!.resumeNextAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(after!.limitResetsAt!.getTime()).toBeLessThan(before - 50_000);
    }));

  it('also retries a failed session, forgetting why it failed, and tells open pages', () =>
    withTestDb(async ({ db }) => {
      const [row] = await db.insert(sessions).values({ ...base, limitState: 'failed', limitDetail: 'Resume failed: x' }).returning();
      const publish = vi.fn();
      await resumeNow(row!.id, { db, eventBus: { publish } });
      const [after] = await db.select().from(sessions).where(eq(sessions.id, row!.id));
      expect(after).toMatchObject({ limitState: 'limited', limitDetail: null });
      expect(publish).toHaveBeenCalledWith({
        kind: 'session_limit',
        sessionId: row!.id,
        limitState: 'limited',
        resumeAt: after!.resumeNextAt!.toISOString(),
        detail: null,
      });
    }));

  it('refuses sessions with no limit, resuming ones, no container or not running', () =>
    withTestDb(async ({ db }) => {
      for (const extra of [{ limitState: 'none' as const }, { limitState: 'resuming' as const }, { limitState: 'limited' as const, containerId: null }, { limitState: 'limited' as const, status: 'stopped' as const }]) {
        const [row] = await db.insert(sessions).values({ ...base, ...extra }).returning();
        await expect(resumeNow(row!.id, { db, eventBus: { publish: () => {} } })).rejects.toBeInstanceOf(ResumeNotApplicableError);
      }
    }));

  it('refuses an unknown session', () =>
    withTestDb(async ({ db }) => {
      await expect(resumeNow('0b5c2a3e-1f2d-4c5b-8a9e-0123456789ab', { db, eventBus: { publish: () => {} } })).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
    }));
});
