import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type Docker from 'dockerode';
import type { Tx } from '@/db/client';
import { repoSettings, sessionProfiles, sessions, type DeliveryMode } from '@/db/schema';
import { dockerErrorDetail, dockerStatusCode } from '@/docker/docker-errors';
import { parseRepoFullName } from '@/github/tokens';
import type { HostStats } from '@/host/host-stats-types';
import { buildMergedConfig, planMerge } from '@/profiles/merge-profiles';
import { toTarStream } from '@/profiles/profile-archive';
import { BASE_PROFILE, listProfiles } from '@/profiles/profile-catalog';
import { hashSessionSecret } from '@/runner-api/session-auth';
import {
  assertBranchFree,
  assertCapacity,
  assertFreeDisk,
  BranchBusyError,
  findBranchHolder,
  isBranchBusyViolation,
  lockCapacity,
  RUNNING_STATUSES,
  StartBlockedError,
  SysboxCheckFailedError,
  SysboxMissingError,
} from './capacity';
import { buildContainerSpec, supportsStorageOpt } from './container-spec';
import { removeSessionResources } from './delete-session';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession, publishLimitCleared, setSessionStatus } from './session-record';
import { CLEARED_LIMIT } from './session-status';
import { sessionShortId, workBranchName } from './work-branch';

export type StartSessionInput = {
  repoFullName: string;
  baseBranch: string;
  profiles: string[];
  startingTask: string | null;
  deliveryMode: DeliveryMode;
  autoResume: boolean;
};

const MAX_ID_ATTEMPTS = 16;

/** Runs a write that may hit the one-live-push-session-per-branch index; the loser is told who holds the branch. */
async function mapBranchBusy<T>(
  deps: SessionDeps,
  repoFullName: string,
  branch: string,
  write: Promise<T>,
  excludeId?: string,
): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (!isBranchBusyViolation(error)) throw error;
    const holder = await findBranchHolder(deps.db, repoFullName, branch, excludeId);
    throw holder ? new BranchBusyError(branch, holder) : error;
  }
}

/** A fresh id whose short id no live session uses, so container, volume and branch names never collide. */
async function pickSessionId(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const id = randomUUID();
    const [clash] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(sql`${sessions.id}::text like ${`${sessionShortId(id)}%`}`, isNull(sessions.deletedAt)))
      .limit(1);
    if (!clash) return id;
  }
  throw new StartBlockedError('Too many sessions to pick a unique short id; delete some old sessions.');
}

async function fetchStats(deps: SessionDeps): Promise<HostStats | null> {
  try {
    return await deps.fetchHostStats();
  } catch {
    console.warn('[sessions] host stats unavailable; skipping the free-disk check');
    return null;
  }
}

async function checkSysbox(deps: SessionDeps): Promise<boolean> {
  if (deps.runtime !== 'sysbox-runc') return true;
  try {
    return await deps.hasSysbox();
  } catch (error) {
    throw new SysboxCheckFailedError(error);
  }
}

/** Creates the container; a daemon that still rejects the disk quota gets the container without it. */
async function createContainer(deps: SessionDeps, spec: Docker.ContainerCreateOptions): Promise<Docker.Container> {
  try {
    return await deps.docker.createContainer(spec);
  } catch (error) {
    const hostConfig = spec.HostConfig;
    if (!hostConfig?.StorageOpt || !/storage-?opt|quota/i.test(dockerErrorDetail(error))) throw error;
    console.warn('[sessions] storage quota not supported by the daemon; disk is watched, not enforced');
    const { StorageOpt: _unsupported, ...rest } = hostConfig;
    return deps.docker.createContainer({ ...spec, HostConfig: rest });
  }
}

/**
 * Starts a session. The cap, disk and Sysbox checks and the insert run in one transaction under the
 * capacity advisory lock, so concurrent starts can never exceed `max_running`. Docker work happens after
 * commit; any failure there leaves the session `failed` with a detail and its container removed.
 */
export async function startSession(
  input: StartSessionInput,
  deps: SessionDeps = sharedSessionDeps(),
): Promise<{ sessionId: string }> {
  const requestedRepo = input.repoFullName.trim();
  parseRepoFullName(requestedRepo);
  const baseBranch = input.baseBranch.trim();
  if (!baseBranch || baseBranch.startsWith('-')) throw new StartBlockedError('Pick a valid base branch.');
  const startingTask = input.startingTask?.trim() ? input.startingTask : null;

  const catalog = await listProfiles(deps.configsDir);
  const { order } = planMerge(input.profiles, catalog.profiles);
  const [merged, stack, stats, sysbox, gitAuthor, repo, storageOptSupported] = await Promise.all([
    buildMergedConfig(deps.configsDir, order),
    deps.discoverStack(),
    fetchStats(deps),
    checkSysbox(deps),
    deps.commitIdentity(),
    // Canonical casing: repo secrets and settings are keyed by GitHub's own `Owner/Name`.
    deps.resolveRepo(requestedRepo),
    deps.docker.info().then(
      (info: { Driver?: string; DriverStatus?: unknown }) => supportsStorageOpt(info),
      () => false,
    ),
  ]);
  const { fullName: repoFullName, defaultBranch } = repo;
  // Before any row or container exists: sessions must never share a network with the Docker API.
  await deps.assertSessionNetwork(stack.networkName);
  if (merged.warnings.length > 0) console.warn(`[sessions] config warnings: ${merged.warnings.join('; ')}`);

  const secret = randomBytes(32).toString('base64url');
  const { deliveryMode, autoResume } = input;
  // Push mode works on the base branch itself, so that is the branch only one live session may hold.
  const startedRow = deps.db.transaction(async (tx) => {
    const { limits, running } = await lockCapacity(tx);
    assertCapacity(running, limits.maxRunning);
    assertFreeDisk(stats, limits.minFreeDiskGb);
    if (!sysbox) throw new SysboxMissingError();
    if (deliveryMode === 'push') await assertBranchFree(tx, repoFullName, baseBranch);

    const sessionId = await pickSessionId(tx);
    const workBranch = deliveryMode === 'push' ? baseBranch : workBranchName(startingTask, sessionId);
    await tx.insert(sessions).values({
      id: sessionId,
      repoFullName,
      baseBranch,
      workBranch,
      defaultBranch,
      startingTask,
      deliveryMode,
      autoResume,
      status: 'starting',
      secretHash: hashSessionSecret(secret),
    });
    await tx.insert(sessionProfiles).values(order.map((profile, position) => ({ sessionId, profile, position })));
    const defaultProfiles = order.filter((profile) => profile !== BASE_PROFILE);
    await tx
      .insert(repoSettings)
      .values({ repoFullName, defaultProfiles })
      .onConflictDoUpdate({ target: repoSettings.repoFullName, set: { defaultProfiles } });
    return { sessionId, workBranch, limits };
  });
  const { sessionId, workBranch, limits } = await mapBranchBusy(deps, repoFullName, baseBranch, startedRow);
  deps.eventBus.publish({ kind: 'session', sessionId, status: 'starting' });

  const spec = buildContainerSpec({
    sessionId,
    secret,
    repoFullName,
    baseBranch,
    defaultBranch,
    workBranch,
    startingTask,
    gitAuthor,
    runnerImage: stack.runnerImage,
    networkName: stack.networkName,
    claudeAuthVolume: stack.claudeAuthVolume,
    runtime: deps.runtime,
    repoUrlTemplate: deps.repoUrlTemplate,
    cpus: limits.cpuPerSession,
    memoryGb: limits.memoryGbPerSession,
    diskGb: limits.diskGbPerSession,
    storageOptSupported,
    deliveryMode,
  });

  let containerId: string | null = null;
  try {
    const container = await createContainer(deps, spec);
    containerId = container.id;
    // Claim the container only while the session is still starting: a Stop or Delete that landed before
    // the container existed wins, and the container goes away again.
    const claimed = await deps.db
      .update(sessions)
      .set({ containerId })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'starting'), isNull(sessions.deletedAt)))
      .returning({ id: sessions.id });
    if (claimed.length === 0) {
      await discardUnclaimedContainer(deps, containerId, sessionId);
      return { sessionId };
    }
    await container.putArchive(toTarStream(merged.config), { path: '/opt' });
    await container.start();
    await honourLateStop(deps, container, sessionId);
  } catch (error) {
    const detail = `Container start failed: ${dockerErrorDetail(error)}`;
    const removed = await removeSessionResources(deps.docker, containerId, sessionId).then(
      () => true,
      () => false,
    );
    // A container that could not be removed stays tracked on the row (so it is neither lost nor an orphan).
    await setSessionStatus(deps, sessionId, 'failed', detail, {
      containerId: removed ? null : containerId,
      endedAt: new Date(),
    });
  }
  return { sessionId };
}

/** The session was stopped or deleted before its container was claimed: remove it, or track it if that fails. */
async function discardUnclaimedContainer(deps: SessionDeps, containerId: string, sessionId: string): Promise<void> {
  try {
    await removeSessionResources(deps.docker, containerId, sessionId);
  } catch {
    await deps.db
      .update(sessions)
      .set({ containerId })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.containerId)));
  }
}

/** A Stop between the claim and `start()` found nothing running; apply it now (Delete removes instead). */
async function honourLateStop(deps: SessionDeps, container: Docker.Container, sessionId: string): Promise<void> {
  const [row] = await deps.db
    .select({ status: sessions.status, deletedAt: sessions.deletedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (row?.deletedAt) {
    await removeSessionResources(deps.docker, container.id, sessionId).catch(() => undefined);
  } else if (row?.status === 'stopped') {
    await container.stop({ t: 10 }).catch(() => undefined);
  }
}

/** Every network the existing container is attached to must pass the session network guard. */
async function assertContainerNetworksSafe(deps: SessionDeps, containerId: string): Promise<void> {
  let networks: string[];
  try {
    const info = (await deps.docker.getContainer(containerId).inspect()) as {
      NetworkSettings?: { Networks?: Record<string, unknown> };
    };
    networks = Object.keys(info.NetworkSettings?.Networks ?? {});
  } catch (error) {
    // Gone: the start below reports it (404 → stopped, "container missing").
    if (dockerStatusCode(error) === 404) return;
    throw error;
  }
  for (const network of networks) await deps.assertSessionNetwork(network);
}

/**
 * Starts a session's existing container again; the runner skips clone/branch and resumes Claude with
 * `--continue`. A stopped or failed session needs a free running slot (same lock as a start); a live one
 * has its container restarted.
 */
export async function restartSession(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  if (!row.containerId) throw new StartBlockedError('This session has no container to restart.');
  await assertContainerNetworksSafe(deps, row.containerId);
  const restarted = deps.db.transaction(async (tx) => {
    const { limits, running } = await lockCapacity(tx);
    const [current] = await tx.select().from(sessions).where(eq(sessions.id, row.id)).for('update');
    if (!current || current.deletedAt) throw new StartBlockedError('This session was deleted.');
    const isRunning = (RUNNING_STATUSES as readonly string[]).includes(current.status);
    if (!isRunning) assertCapacity(running, limits.maxRunning);
    if (!isRunning && current.deliveryMode === 'push') {
      await assertBranchFree(tx, current.repoFullName, current.workBranch, current.id);
    }
    // A restarted Claude starts afresh: a limit from before (or a crashed resume) no longer applies.
    await tx
      .update(sessions)
      .set({ ...CLEARED_LIMIT, status: 'starting', statusDetail: null, endedAt: null, remoteControlUrl: null })
      .where(eq(sessions.id, row.id));
    return { wasRunning: isRunning, remoteControlUrl: current.remoteControlUrl, hadLimit: current.limitState !== 'none' };
  });
  const { wasRunning, remoteControlUrl, hadLimit } = await mapBranchBusy(deps, row.repoFullName, row.workBranch, restarted, row.id);
  deps.eventBus.publish({ kind: 'session', sessionId: row.id, status: 'starting' });
  if (hadLimit) publishLimitCleared(deps, row.id);

  const container = deps.docker.getContainer(row.containerId);
  try {
    if (wasRunning) await container.restart({ t: 10 });
    else await container.start();
  } catch (error) {
    // 304: already running, which is what was asked for. The runner does not boot again, so no event
    // would ever move the row off `starting`: record it as waiting on the owner instead.
    if (dockerStatusCode(error) === 304) {
      // Nor would it report its Remote Control link again: keep the one it had.
      await setSessionStatus(
        deps,
        row.id,
        'idle',
        'container was already running',
        { remoteControlUrl },
        eq(sessions.status, 'starting'),
      );
      return;
    }
    if (dockerStatusCode(error) === 404) {
      await setSessionStatus(deps, row.id, 'stopped', 'container missing', { endedAt: new Date() });
      return;
    }
    const detail = `Container start failed: ${dockerErrorDetail(error)}`;
    await setSessionStatus(deps, row.id, 'failed', detail, { endedAt: new Date() });
  }
}
