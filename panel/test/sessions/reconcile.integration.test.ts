import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { sessions, type SessionStatus } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { hashSessionSecret } from '@/runner-api/session-auth';
import { reconcile } from '@/sessions/reconcile';
import { fakeDocker, testDeps } from './session-test-deps';

async function insertSession(db: Db, status: SessionStatus, containerId: string | null) {
  const id = randomUUID();
  await db.insert(sessions).values({
    id,
    repoFullName: 'acme/widgets',
    baseBranch: 'main',
    workBranch: `claude/x-${id.slice(0, 4)}`,
    defaultBranch: 'main',
    status,
    containerId,
    secretHash: hashSessionSecret(id),
  });
  return id;
}

const labeled = (sessionId: string, containerId: string, state: string) => ({
  Id: containerId,
  Names: [`/claudecloud-session-${sessionId.slice(0, 4)}`],
  Labels: { 'claudecloud.session': sessionId, 'claudecloud.role': 'session' },
  State: state,
});

const rowOf = async (db: Db, id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]!;

describe('reconcile', () => {
  it('stops (never removes) active containers of failed or stopped sessions; leaves the rest alone', () =>
    withTestDb(async ({ db }) => {
      const failedRunning = await insertSession(db, 'failed', 'c-failed');
      const stoppedRestarting = await insertSession(db, 'stopped', 'c-stopped');
      const failedExited = await insertSession(db, 'failed', 'c-exited');
      const working = await insertSession(db, 'working', 'c-working');
      const { docker, calls } = fakeDocker({
        containers: [
          labeled(failedRunning, 'c-failed', 'running'),
          labeled(stoppedRestarting, 'c-stopped', 'restarting'),
          labeled(failedExited, 'c-exited', 'exited'),
          labeled(working, 'c-working', 'running'),
        ],
      });
      await reconcile(testDeps(db, { docker }));
      expect([...calls].sort()).toEqual(['stop c-failed', 'stop c-stopped']);
      expect(await rowOf(db, failedRunning)).toMatchObject({ status: 'failed', containerId: 'c-failed' });
      expect(await rowOf(db, working)).toMatchObject({ status: 'working', containerId: 'c-working' });
    }));

  it('adopts a running container with its status and secret; marks missing and exited ones stopped', () =>
    withTestDb(async ({ db }) => {
      const adopted = await insertSession(db, 'waiting', 'c-1');
      const missing = await insertSession(db, 'working', 'c-gone');
      const exited = await insertSession(db, 'idle', 'c-3');
      const before = await rowOf(db, adopted);
      const { docker, calls } = fakeDocker({
        containers: [labeled(adopted, 'c-1', 'running'), labeled(exited, 'c-3', 'exited')],
      });
      await reconcile(testDeps(db, { docker }));
      expect(await rowOf(db, adopted)).toEqual(before);
      expect(await rowOf(db, missing)).toMatchObject({ status: 'stopped', statusDetail: 'container missing' });
      expect(await rowOf(db, exited)).toMatchObject({ status: 'stopped', statusDetail: 'container exited' });
      expect(calls).toEqual([]);
    }));

  it('a session it marks stopped no longer waits on a limit', () =>
    withTestDb(async ({ db }) => {
      const id = await insertSession(db, 'idle', 'c-gone');
      await db
        .update(sessions)
        .set({ limitState: 'limited', limitResetsAt: new Date(), resumeNextAt: new Date(), resumeAttempts: 1 })
        .where(eq(sessions.id, id));
      const published: unknown[] = [];
      await reconcile(testDeps(db, { docker: fakeDocker().docker, eventBus: { publish: (event) => void published.push(event) } }));
      expect(await rowOf(db, id)).toMatchObject({ status: 'stopped', limitState: 'none', resumeNextAt: null, resumeAttempts: 0 });
      expect(published).toContainEqual({ kind: 'session_limit', sessionId: id, limitState: 'none', resumeAt: null, detail: null });
    }));

  it('writes are compare-and-set: a row that changed after the read is not overwritten', () =>
    withTestDb(async ({ db }) => {
      const id = await insertSession(db, 'working', 'c-1');
      const { docker } = fakeDocker({
        containers: [labeled(id, 'c-1', 'exited')],
        // A restart commits `starting` between reconcile's row read and its write.
        onList: async () => {
          await db.update(sessions).set({ status: 'starting' }).where(eq(sessions.id, id));
        },
      });
      await reconcile(testDeps(db, { docker }));
      expect(await rowOf(db, id)).toMatchObject({ status: 'starting', statusDetail: null });
    }));
});
