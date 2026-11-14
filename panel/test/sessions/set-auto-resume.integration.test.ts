import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { SessionNotFoundError } from '@/sessions/session-record';
import { setAutoResume } from '@/sessions/set-auto-resume';

const base = { repoFullName: 'acme/widgets', baseBranch: 'main', workBranch: 'claude/s-1', defaultBranch: 'main', secretHash: 'hash' };
const resetsAt = new Date('2026-11-14T20:00:00Z');

describe('setAutoResume', () => {
  it('turning it on leaves the limit state alone', () =>
    withTestDb(async ({ db }) => {
      const [row] = await db.insert(sessions).values({ ...base, limitState: 'limited', limitResetsAt: resetsAt }).returning();
      await setAutoResume(row!.id, true, { db });
      const [after] = await db.select().from(sessions).where(eq(sessions.id, row!.id));
      expect(after).toMatchObject({ autoResume: true, limitState: 'limited', limitResetsAt: resetsAt });
    }));

  it('turning it off clears the limit state, attempts, times and detail', () =>
    withTestDb(async ({ db }) => {
      const [row] = await db
        .insert(sessions)
        .values({
          ...base,
          autoResume: true,
          limitState: 'resuming',
          limitResetsAt: resetsAt,
          resumeAttempts: 2,
          resumeNextAt: resetsAt,
          limitDetail: 'Waiting',
        })
        .returning();
      await setAutoResume(row!.id, false, { db });
      const [after] = await db.select().from(sessions).where(eq(sessions.id, row!.id));
      expect(after).toMatchObject({
        autoResume: false,
        limitState: 'none',
        limitResetsAt: null,
        resumeAttempts: 0,
        resumeNextAt: null,
        limitDetail: null,
      });
    }));

  it('refuses an unknown or deleted session', () =>
    withTestDb(async ({ db }) => {
      await expect(setAutoResume('0b5c2a3e-1f2d-4c5b-8a9e-0123456789ab', true, { db })).rejects.toBeInstanceOf(SessionNotFoundError);
      const [row] = await db.insert(sessions).values({ ...base, deletedAt: new Date() }).returning();
      await expect(setAutoResume(row!.id, true, { db })).rejects.toBeInstanceOf(SessionNotFoundError);
    }));
});
