import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import { dockerErrorDetail, dockerStatusCode } from '@/docker/docker-errors';
import { RUNNING_STATUSES, takeCapacityLock } from './capacity';
import { ROLE_LABEL, SESSION_LABEL, SESSION_ROLE } from './container-spec';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { isSessionId, setSessionStatus } from './session-record';

const RECONCILE_INTERVAL_MS = 60_000;
/** A live row with no container yet is a start in progress for this long (create follows the insert). */
const START_GRACE_MS = 5 * 60_000;
/** Docker states that mean the container is gone for good until someone starts it again. */
const ENDED_STATES = new Set(['exited', 'dead']);
/** Docker states in which a container uses resources (or is about to). */
const ACTIVE_STATES = new Set(['running', 'restarting']);
/** Row statuses whose container must not be running. */
const ENDED_ROW_STATUSES = ['failed', 'stopped'] as const;
const STOP_TIMEOUT_S = 10;

export type LabeledContainer = { containerId: string; name: string; sessionId: string; state: string };
export type OrphanContainer = LabeledContainer;

async function listSessionContainers(deps: Pick<SessionDeps, 'docker'>): Promise<LabeledContainer[]> {
  const containers = await deps.docker.listContainers({
    all: true,
    filters: { label: [`${ROLE_LABEL}=${SESSION_ROLE}`] },
  });
  return containers.map((c) => ({
    containerId: c.Id,
    name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
    sessionId: (c.Labels?.[SESSION_LABEL] ?? '').toLowerCase(),
    state: c.State ?? 'unknown',
  }));
}

/**
 * Brings rows in line with Docker:
 * - A running container keeps its row's status and secret (a panel redeploy adopts it untouched, never
 *   starting another).
 * - A live row whose container is gone becomes `stopped` ("container missing"); one whose container
 *   exited becomes `stopped` ("container exited"). Both writes are compare-and-set against what was read.
 * - A container still running (or restart-looping) for a `failed` or `stopped` row is stopped, not removed:
 *   `unless-stopped` would otherwise retry a failed boot forever outside the running cap.
 * Containers without a live row are left alone; `listOrphans()` reports them.
 */
export async function reconcile(deps: SessionDeps = sharedSessionDeps()): Promise<void> {
  // Rows before containers: a start that sets containerId after this read is skipped (null id), and one
  // that set it before is already visible in the container list.
  const rows = await deps.db
    .select({
      id: sessions.id,
      status: sessions.status,
      containerId: sessions.containerId,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(inArray(sessions.status, [...RUNNING_STATUSES]), isNull(sessions.deletedAt)));
  const containers = await listSessionContainers(deps);
  const bySession = new Map(containers.map((c) => [c.sessionId, c]));
  const now = Date.now();

  await Promise.all(
    rows.map(async (row) => {
      const container = bySession.get(row.id);
      if (container && !ENDED_STATES.has(container.state)) return;
      if (!container && !row.containerId && now - row.createdAt.getTime() < START_GRACE_MS) return;
      const unchanged = and(
        eq(sessions.status, row.status),
        row.containerId ? eq(sessions.containerId, row.containerId) : isNull(sessions.containerId),
        isNull(sessions.deletedAt),
      );
      const detail = container ? 'container exited' : 'container missing';
      await setSessionStatus(deps, row.id, 'stopped', detail, { endedAt: new Date() }, unchanged);
    }),
  );

  await stopEndedSessionContainers(deps, containers);
}

/** Stops containers that are active although their (live) row is `failed` or `stopped`. */
async function stopEndedSessionContainers(deps: SessionDeps, containers: LabeledContainer[]): Promise<void> {
  const active = containers.filter((c) => ACTIVE_STATES.has(c.state) && isSessionId(c.sessionId));
  if (active.length === 0) return;
  const ended = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        inArray(sessions.id, [...new Set(active.map((c) => c.sessionId))]),
        inArray(sessions.status, [...ENDED_ROW_STATUSES]),
        isNull(sessions.deletedAt),
      ),
    );
  const endedIds = new Set(ended.map((row) => row.id));
  for (const container of active.filter((c) => endedIds.has(c.sessionId))) {
    // Under the capacity lock, re-checked: a restart commits `starting` under the same lock before it
    // starts the container, so this never stops a session that is being restarted.
    await deps.db.transaction(async (tx) => {
      await takeCapacityLock(tx);
      const [row] = await tx
        .select({ status: sessions.status, deletedAt: sessions.deletedAt })
        .from(sessions)
        .where(eq(sessions.id, container.sessionId));
      if (!row || row.deletedAt || !(ENDED_ROW_STATUSES as readonly string[]).includes(row.status)) return;
      try {
        await deps.docker.getContainer(container.containerId).stop({ t: STOP_TIMEOUT_S });
      } catch (error) {
        const status = dockerStatusCode(error);
        if (status !== 304 && status !== 404) throw error;
      }
    });
  }
}

/** Labeled session containers with no live session row. Shown in the UI for manual removal only. */
export async function listOrphans(deps: SessionDeps = sharedSessionDeps()): Promise<OrphanContainer[]> {
  const containers = await listSessionContainers(deps);
  const ids = [...new Set(containers.map((c) => c.sessionId).filter(isSessionId))];
  const live =
    ids.length === 0
      ? []
      : await deps.db
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(inArray(sessions.id, ids), isNull(sessions.deletedAt)));
  const liveIds = new Set(live.map((row) => row.id));
  return containers.filter((c) => !liveIds.has(c.sessionId));
}

const globalForReconcile = globalThis as typeof globalThis & { __reconcileTimer?: NodeJS.Timeout };

/** Runs `reconcile()` now and every 60 s, once per process. Failures are logged, never thrown. */
export function startReconcileLoop(intervalMs: number = RECONCILE_INTERVAL_MS): void {
  if (globalForReconcile.__reconcileTimer) return;
  let inFlight = false;
  const run = async () => {
    if (inFlight) return; // a slow Docker must not stack overlapping passes
    inFlight = true;
    try {
      await reconcile();
    } catch (error) {
      console.warn(`[sessions] reconcile failed: ${dockerErrorDetail(error)}`);
    } finally {
      inFlight = false;
    }
  };
  void run();
  globalForReconcile.__reconcileTimer = setInterval(() => void run(), intervalMs);
  globalForReconcile.__reconcileTimer.unref();
}
