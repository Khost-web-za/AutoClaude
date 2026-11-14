import http from 'node:http';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db as sharedDb, type Db } from '@/db/client';
import { sessionEvents, sessions } from '@/db/schema';
import { getPanelEnv } from '@/env/panel-env';
import { GithubApiError } from '@/github/github-api';
import { NoInstallationError } from '@/github/tokens';
import { eventBus } from '@/live/event-bus';
import { secretStore as sharedSecretStore, type SecretStore } from '@/secret-store/secret-store';
import { isBranchBusyViolation } from '@/sessions/capacity';
import { nextStatus, redactEventData, type RunnerEvent } from '@/sessions/session-status';
import { verifySession, type Session } from './session-auth';

const MAX_BODY_BYTES = 64 * 1024;

export type GitCredential = { username: 'x-access-token'; password: string; expiresAt: string };
export type MintGitCredential = (repoFullName: string) => Promise<GitCredential>;

export type RunnerApiDeps = {
  db: Db;
  secretStore: Pick<SecretStore, 'getMany'>;
  mintGitCredential: MintGitCredential;
};

const eventBody = z.object({
  type: z.enum(['boot_step', 'remote_control_url', 'hook', 'workspace_sync', 'claude_exited']),
  data: z.record(z.string(), z.unknown()).default({}),
  at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 timestamp'),
});
const credentialBody = z.object({ repo: z.string().min(1) });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

function bearer(req: http.IncomingMessage): string | null {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

export function createRunnerApiServer(deps: RunnerApiDeps): http.Server {
  const { db, secretStore, mintGitCredential } = deps;

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };

  async function recordEvent(session: Session, event: RunnerEvent): Promise<void> {
    const at = new Date(event.at);
    const change = await db.transaction(async (tx) => {
      // Lock the row so concurrent events apply to the latest status in arrival order.
      const [row] = await tx.select().from(sessions).where(eq(sessions.id, session.id)).for('update');
      await tx.insert(sessionEvents).values({
        sessionId: session.id,
        type: event.type,
        data: redactEventData(event.data),
        at,
      });
      if (!row || row.deletedAt) return null;
      const next = nextStatus(row.status, event);
      const url = event.type === 'remote_control_url' ? event.data.url : undefined;
      const status = next?.status ?? row.status;
      // A url arriving after Stop belongs to a session that is no longer running: keep the row as it is.
      const remoteControlUrl = typeof url === 'string' && url && status !== 'stopped' ? url : undefined;
      if (!next && !remoteControlUrl) return null;
      try {
        // A savepoint: a violation aborts only this update, so the event row above still commits.
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(sessions)
            .set({
              status,
              statusDetail: next ? (next.detail ?? null) : row.statusDetail,
              ...(remoteControlUrl ? { remoteControlUrl } : {}),
              ...(next?.status === 'starting' ? { endedAt: null, remoteControlUrl: null } : {}),
              ...(next?.status === 'working' || next?.status === 'starting'
                ? { startedAt: sql`coalesce(${sessions.startedAt}, now())` }
                : {}),
            })
            .where(eq(sessions.id, session.id));
        });
      } catch (error) {
        // Bringing a stopped/failed push session back to life can collide with another live session on the
        // branch. Keep the event without the status change; reconcile then stops the container as usual.
        if (isBranchBusyViolation(error)) return null;
        throw error;
      }
      return { status, detail: next?.detail, remoteControlUrl };
    });

    eventBus.publish({ kind: 'session_event', sessionId: session.id, type: event.type, at: event.at });
    if (change) {
      eventBus.publish({
        kind: 'session',
        sessionId: session.id,
        status: change.status,
        ...(change.detail !== undefined ? { detail: change.detail } : {}),
        ...(change.remoteControlUrl ? { remoteControlUrl: change.remoteControlUrl } : {}),
      });
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    const route =
      req.method === 'POST' && path === '/api/runner/events'
        ? 'events'
        : req.method === 'POST' && path === '/api/runner/git-credential'
          ? 'git-credential'
          : req.method === 'GET' && path === '/api/runner/secrets'
            ? 'secrets'
            : null;
    if (!route) return sendJson(res, 404, { error: 'not found' });

    const sessionId = req.headers['x-session-id'];
    const secret = bearer(req);
    const session =
      typeof sessionId === 'string' && secret ? await verifySession(sessionId, secret, db) : null;
    if (!session) {
      req.resume();
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (route === 'secrets') {
      const prefix = `${session.repoFullName}:`;
      const all = await secretStore.getMany('repo', prefix);
      const secretsByName = Object.fromEntries(
        Object.entries(all).map(([ref, value]) => [ref.slice(prefix.length), value]),
      );
      return sendJson(res, 200, { secrets: secretsByName });
    }

    const body = await readJson(req);
    if (route === 'events') {
      const parsed = eventBody.safeParse(body);
      if (!parsed.success) return sendJson(res, 400, { error: 'invalid event' });
      await recordEvent(session, parsed.data);
      res.writeHead(204).end();
      return;
    }

    const parsed = credentialBody.safeParse(body);
    if (!parsed.success) return sendJson(res, 400, { error: 'invalid body' });
    if (parsed.data.repo !== session.repoFullName) return sendJson(res, 403, { error: 'forbidden' });
    let credential: GitCredential;
    try {
      credential = await mintGitCredential(session.repoFullName);
    } catch (error) {
      // GithubApiError / NoInstallationError messages carry GitHub's reason and never a token.
      const known = error instanceof GithubApiError || error instanceof NoInstallationError;
      console.error(
        `[runner-api] git credential unavailable for ${session.repoFullName}:`,
        known ? error.message : error instanceof Error ? error.name : 'error',
      );
      return sendJson(res, 502, { error: 'git credential unavailable' });
    }
    return sendJson(res, 200, credential);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      console.error('[runner-api] request failed:', error instanceof Error ? error.message : 'error');
      sendJson(res, 500, { error: 'internal error' });
    });
  });
}

let mintGitCredentialImpl: MintGitCredential = () => {
  throw new Error('no git credential minter registered');
};

/** Task 9 registers the real GitHub-backed minter; until then credential requests answer 502. */
export function registerGitCredentialMinter(mint: MintGitCredential): void {
  mintGitCredentialImpl = mint;
}

const globalForRunnerApi = globalThis as typeof globalThis & { __runnerApiStarted?: boolean };

/** Starts the internal listener once per process. Never published; reachable only on the stack network. */
export function startRunnerApi(): http.Server | null {
  if (globalForRunnerApi.__runnerApiStarted) return null;
  globalForRunnerApi.__runnerApiStarted = true;
  const server = createRunnerApiServer({
    db: sharedDb,
    secretStore: sharedSecretStore,
    mintGitCredential: (repo) => mintGitCredentialImpl(repo),
  });
  const port = getPanelEnv().runnerApiPort;
  server.on('error', (error) => {
    console.error('[runner-api] listener error:', error.message);
    globalForRunnerApi.__runnerApiStarted = false;
  });
  server.listen(port, '0.0.0.0', () => console.log(`[runner-api] listening on :${port}`));
  return server;
}
