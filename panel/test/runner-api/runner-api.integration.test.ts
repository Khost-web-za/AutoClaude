import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { sessionEvents, sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { eventBus, type LiveEvent } from '@/live/event-bus';
import { createRunnerApiServer } from '@/runner-api/runner-api-server';
import { hashSessionSecret } from '@/runner-api/session-auth';
import { createSecretStore } from '@/secret-store/secret-store';

const key = randomBytes(32);
const credential = { username: 'x-access-token' as const, password: 'ghs_injected', expiresAt: '2030-01-01T00:00:00.000Z' };

async function boot(db: Db) {
  const secretStore = createSecretStore({ db, key });
  const mintCalls: string[] = [];
  const server = createRunnerApiServer({
    db,
    secretStore,
    mintGitCredential: async (repo) => {
      mintCalls.push(repo);
      return credential;
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const secret = 'secret-abc';
  const [session] = await db
    .insert(sessions)
    .values({
      repoFullName: 'acme/widgets',
      baseBranch: 'main',
      workBranch: 'claude/x-1234',
      defaultBranch: 'main',
      secretHash: hashSessionSecret(secret),
    })
    .returning();
  const id = session!.id;
  const call = (path: string, init: { method?: string; body?: unknown; secret?: string; id?: string } = {}) =>
    fetch(base + path, {
      method: init.method ?? 'POST',
      headers: {
        authorization: `Bearer ${init.secret ?? secret}`,
        'x-session-id': init.id ?? id,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  return { db, server, secretStore, mintCalls, id, secret, call };
}

type Ctx = Awaited<ReturnType<typeof boot>>;

function setup(fn: (ctx: Ctx) => Promise<void>) {
  return withTestDb(async ({ db }) => {
    const ctx = await boot(db);
    try {
      await fn(ctx);
    } finally {
      await new Promise((r) => {
        ctx.server.closeAllConnections();
        ctx.server.close(r);
      });
    }
  });
}

const event = (type: string, data: Record<string, unknown>) => ({ type, data, at: new Date().toISOString() });

describe('runner api', () => {
  it('401 on wrong secret', () =>
    setup(async ({ call }) => {
      const res = await call('/api/runner/events', { body: event('hook', { event: 'Stop' }), secret: 'nope' });
      expect(res.status).toBe(401);
    }));

  it('401 for an unknown session id', () =>
    setup(async ({ call }) => {
      const res = await call('/api/runner/secrets', {
        method: 'GET',
        id: '00000000-0000-4000-8000-000000000000',
      });
      expect(res.status).toBe(401);
    }));

  it('401 for a deleted session', () =>
    setup(async ({ db, id, call }) => {
      await db.update(sessions).set({ deletedAt: new Date() }).where(eq(sessions.id, id));
      const res = await call('/api/runner/events', { body: event('hook', { event: 'Stop' }) });
      expect(res.status).toBe(401);
    }));

  it('204 on a valid event, status updated, url stored, live events published', () =>
    setup(async ({ db, id, call }) => {
      const seen: LiveEvent[] = [];
      const off = eventBus.subscribe((e) => seen.push(e));
      const url = 'https://claude.ai/code/session_1';
      const res = await call('/api/runner/events', { body: event('remote_control_url', { url }) });
      expect(res.status).toBe(204);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      expect(row?.status).toBe('working');
      expect(row?.remoteControlUrl).toBe(url);
      const res2 = await call('/api/runner/events', { body: event('hook', { event: 'Stop' }) });
      expect(res2.status).toBe(204);
      const [row2] = await db.select().from(sessions).where(eq(sessions.id, id));
      expect(row2?.status).toBe('idle');
      off();
      expect(seen.some((e) => e.kind === 'session' && e.sessionId === id && e.status === 'idle')).toBe(true);
      expect(seen.some((e) => e.kind === 'session_event' && e.type === 'hook')).toBe(true);
    }));

  it('204 on a workspace_sync event', () =>
    setup(async ({ call }) => {
      const res = await call('/api/runner/events', {
        body: event('workspace_sync', { status: 'ok', summary: 'up to date', source: 'startup' }),
      });
      expect(res.status).toBe(204);
    }));

  it('keeps the event but not the status when reviving a push session would collide with a live one', () =>
    setup(async ({ db, id, call }) => {
      const push = { repoFullName: 'acme/widgets', baseBranch: 'main', workBranch: 'main', defaultBranch: 'main', deliveryMode: 'push' as const };
      await db.update(sessions).set({ ...push, status: 'stopped' }).where(eq(sessions.id, id));
      await db.insert(sessions).values({ ...push, status: 'idle', secretHash: hashSessionSecret('other') });
      const res = await call('/api/runner/events', { body: event('boot_step', { step: 'docker', status: 'started' }) });
      expect(res.status).toBe(204);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      expect(row?.status).toBe('stopped');
      const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, id));
      expect(events.map((e) => e.type)).toEqual(['boot_step']);
    }));

  it('400 on invalid body, 404 on unknown route', () =>
    setup(async ({ call }) => {
      expect((await call('/api/runner/events', { body: { type: 'bogus', data: {}, at: 'x' } })).status).toBe(400);
      expect((await call('/api/runner/nope', { body: {} })).status).toBe(404);
    }));

  it('413 over the 64 KB body limit', () =>
    setup(async ({ call }) => {
      const res = await call('/api/runner/events', {
        body: event('hook', { event: 'Stop', message: 'x'.repeat(70_000) }),
      });
      expect(res.status).toBe(413);
    }));

  it('git-credential returns the injected credential for the session repo only', () =>
    setup(async ({ call, mintCalls }) => {
      const res = await call('/api/runner/git-credential', { body: { repo: 'acme/widgets' } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(credential);
      expect(mintCalls).toEqual(['acme/widgets']);
      const other = await call('/api/runner/git-credential', { body: { repo: 'evil/other' } });
      expect(other.status).toBe(403);
      expect(mintCalls).toEqual(['acme/widgets']);
    }));

  it('secrets returns only this repo keys', () =>
    setup(async ({ call, secretStore }) => {
      await secretStore.put('repo', 'acme/widgets:API_KEY', 'v1');
      await secretStore.put('repo', 'acme/other:API_KEY', 'v2');
      await secretStore.put('repo', 'acme/widgets-extra:X', 'v3');
      const res = await call('/api/runner/secrets', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ secrets: { API_KEY: 'v1' } });
    }));

  it('an event containing data.token is stored without it', () =>
    setup(async ({ db, id, call }) => {
      const res = await call('/api/runner/events', {
        body: event('hook', { event: 'Notification', message: 'hi', token: 'leak', nested: { apiKey: 'leak2' } }),
      });
      expect(res.status).toBe(204);
      const [row] = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, id));
      expect(JSON.stringify(row?.data)).not.toContain('leak');
      expect(row?.data).toMatchObject({ event: 'Notification', message: 'hi' });
    }));
  it('a late remote_control_url on a stopped session is neither stored nor published', () =>
    setup(async ({ db, id, call }) => {
      await db.update(sessions).set({ status: 'stopped', remoteControlUrl: null }).where(eq(sessions.id, id));
      const seen: LiveEvent[] = [];
      const off = eventBus.subscribe((e) => seen.push(e));
      const res = await call('/api/runner/events', { body: event('remote_control_url', { url: 'https://claude.ai/code/late' }) });
      off();
      expect(res.status).toBe(204);
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
      expect(row).toMatchObject({ status: 'stopped', remoteControlUrl: null });
      expect(seen.some((e) => e.kind === 'session' && e.sessionId === id)).toBe(false);
      expect(seen.some((e) => e.kind === 'session_event' && e.sessionId === id)).toBe(true);
    }));
});
