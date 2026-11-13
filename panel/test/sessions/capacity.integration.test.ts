import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { repoSettings, sessionProfiles, sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import type { HostStats } from '@/host/host-stats-types';
import {
  CapacityError,
  InsufficientDiskError,
  SysboxCheckFailedError,
  SysboxMissingError,
} from '@/sessions/capacity';
import { restartSession, startSession } from '@/sessions/start-session';
import { stopSession } from '@/sessions/stop-session';
import { fakeDocker, setMaxRunning, testDeps } from './session-test-deps';

const input = { repoFullName: 'acme/widgets', baseBranch: 'main', profiles: ['frontend'], startingTask: 'Fix the bug' };
const GB = 1024 ** 3;

describe('startSession capacity (Review Focus 3)', () => {
  it('two concurrent starts with max_running 1: exactly one succeeds, the other is CapacityError', () =>
    withTestDb(async ({ db }) => {
      await setMaxRunning(db, 1);
      const deps = testDeps(db);
      const results = await Promise.allSettled([startSession(input, deps), startSession(input, deps)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(CapacityError);
      expect(await db.select().from(sessions)).toHaveLength(1);
    }));

  it('five concurrent starts with max_running 3 leave exactly 3 rows', () =>
    withTestDb(async ({ db }) => {
      const deps = testDeps(db);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => startSession(input, deps)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await db.select().from(sessions)).toHaveLength(3);
    }));

  it('restarting a stopped session needs a free slot', () =>
    withTestDb(async ({ db }) => {
      await setMaxRunning(db, 1);
      const deps = testDeps(db);
      const { sessionId: first } = await startSession(input, deps);
      await stopSession(first, deps);
      await startSession(input, deps);
      await expect(restartSession(first, deps)).rejects.toBeInstanceOf(CapacityError);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, first));
      expect(row?.status).toBe('stopped');
    }));
});

describe('startSession bookkeeping', () => {
  it('inserts the session, its profiles in merge order and the repo default profiles, then creates, fills and starts the container', () =>
    withTestDb(async ({ db }) => {
      const { docker, calls } = fakeDocker();
      const { sessionId } = await startSession(input, testDeps(db, { docker }));
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ status: 'starting', repoFullName: 'acme/widgets', defaultBranch: 'main', containerId: 'fake-1' });
      expect(row?.workBranch).toBe(`claude/fix-the-bug-${sessionId.slice(0, 4)}`);
      expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
      const profiles = await db.select().from(sessionProfiles).orderBy(asc(sessionProfiles.position));
      expect(profiles.map((p) => p.profile)).toEqual(['base', 'frontend']);
      const [defaults] = await db.select().from(repoSettings);
      expect(defaults?.defaultProfiles).toEqual(['frontend']);
      expect(calls).toEqual([`create claudecloud-session-${sessionId.slice(0, 4)}`, 'putArchive fake-1', 'start fake-1']);
    }));

  it('a Docker failure marks the session failed with a detail and removes container and volume', () =>
    withTestDb(async ({ db }) => {
      const { docker, calls } = fakeDocker({ failStart: true });
      const { sessionId } = await startSession(input, testDeps(db, { docker }));
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ status: 'failed', containerId: null });
      expect(row?.statusDetail).toContain('no such runtime');
      expect(calls).toContain('remove fake-1');
      expect(calls).toContain(`removeVolume claudecloud-session-${sessionId.slice(0, 4)}-docker`);
    }));

  it('refuses below min free disk, skips the check without stats', () =>
    withTestDb(async ({ db }) => {
      const low: HostStats = {
        disk: { totalBytes: 100 * GB, freeBytes: 5 * GB, path: '/' },
        cpu: { pct: 1 },
        memory: { totalBytes: GB, availableBytes: GB },
      };
      await expect(startSession(input, testDeps(db, { fetchHostStats: async () => low }))).rejects.toBeInstanceOf(
        InsufficientDiskError,
      );
      await expect(startSession(input, testDeps(db, { fetchHostStats: async () => null }))).resolves.toBeTruthy();
    }));

  it('sysbox-runc: missing runtime is SysboxMissingError, a failed check is SysboxCheckFailedError; runc never asks', () =>
    withTestDb(async ({ db }) => {
      await expect(
        startSession(input, testDeps(db, { runtime: 'sysbox-runc', hasSysbox: async () => false })),
      ).rejects.toBeInstanceOf(SysboxMissingError);
      await expect(
        startSession(input, testDeps(db, { runtime: 'sysbox-runc', hasSysbox: () => Promise.reject(new Error('down')) })),
      ).rejects.toBeInstanceOf(SysboxCheckFailedError);
      let asked = false;
      await startSession(input, testDeps(db, { hasSysbox: async () => ((asked = true), true) }));
      expect(asked).toBe(false);
      expect(await db.select().from(sessions)).toHaveLength(1);
    }));
});

describe('startSession races with Stop and cleanup failures', () => {
  it('a Stop before the container is claimed wins: the container is removed and never started', () =>
    withTestDb(async ({ db }) => {
      let deps = testDeps(db);
      const { docker, calls } = fakeDocker({
        onCreate: async () => {
          const [row] = await db.select().from(sessions);
          await stopSession(row!.id, deps);
        },
      });
      deps = testDeps(db, { docker });
      const { sessionId } = await startSession(input, deps);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ status: 'stopped', containerId: null });
      expect(calls).toContain('remove fake-1');
      expect(calls).not.toContain('putArchive fake-1');
      expect(calls).not.toContain('start fake-1');
    }));

  it('a Stop between the claim and start() is applied right after the start', () =>
    withTestDb(async ({ db }) => {
      let deps = testDeps(db);
      const { docker, calls } = fakeDocker({
        onStart: async () => {
          const [row] = await db.select().from(sessions);
          await stopSession(row!.id, deps);
        },
      });
      deps = testDeps(db, { docker });
      const { sessionId } = await startSession(input, deps);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ status: 'stopped', containerId: 'fake-1' });
      expect(calls.slice(-2)).toEqual(['stop fake-1', 'stop fake-1']);
    }));

  it('a failed start whose cleanup fails keeps the container tracked on the row', () =>
    withTestDb(async ({ db }) => {
      const { docker } = fakeDocker({ failStart: true, failRemove: true });
      const { sessionId } = await startSession(input, testDeps(db, { docker }));
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ status: 'failed', containerId: 'fake-1' });
    }));
});

describe('startSession repository name (Task 14 carry)', () => {
  it('stores GitHub canonical casing, so repo secrets, settings and the repo Sessions tab line up', () =>
    withTestDb(async ({ db }) => {
      const asked: string[] = [];
      const deps = testDeps(db, {
        resolveRepo: async (fullName) => {
          asked.push(fullName);
          return { fullName: 'Acme/Widgets', defaultBranch: 'trunk' };
        },
      });
      const { sessionId } = await startSession({ ...input, repoFullName: ' acme/widgets ' }, deps);
      expect(asked).toEqual(['acme/widgets']);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row).toMatchObject({ repoFullName: 'Acme/Widgets', defaultBranch: 'trunk' });
      const [defaults] = await db.select().from(repoSettings);
      expect(defaults?.repoFullName).toBe('Acme/Widgets');
    }));

  it('a repository the App cannot see is refused before anything is created', () =>
    withTestDb(async ({ db }) => {
      const deps = testDeps(db, {
        resolveRepo: async () => {
          throw new Error('not accessible');
        },
      });
      await expect(startSession(input, deps)).rejects.toThrow('not accessible');
      expect(await db.select().from(sessions)).toHaveLength(0);
    }));
});

describe('restartSession on a container that is already running (Task 11 carry)', () => {
  it('a 304 from start does not leave the row at starting and keeps the Open in Claude link', () =>
    withTestDb(async ({ db }) => {
      const base = fakeDocker();
      const deps = testDeps(db, { docker: base.docker });
      const { sessionId } = await startSession(input, deps);
      await stopSession(sessionId, deps);
      await db.update(sessions).set({ remoteControlUrl: 'https://claude.ai/code/remote/abc' }).where(eq(sessions.id, sessionId));
      const docker = {
        ...base.docker,
        getContainer: (id: string) => ({
          ...base.docker.getContainer(id),
          start: async () => {
            throw Object.assign(new Error('already started'), { statusCode: 304 });
          },
        }),
      } as unknown as typeof base.docker;
      await restartSession(sessionId, testDeps(db, { docker }));
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(row?.status).toBe('idle');
      expect(row?.statusDetail).toBe('container was already running');
      // The runner does not boot again, so no new link would ever arrive: the old one is kept.
      expect(row?.remoteControlUrl).toBe('https://claude.ai/code/remote/abc');
    }));
});
