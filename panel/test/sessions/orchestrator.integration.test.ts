import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import Docker from 'dockerode';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { sessions, settings } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { dockerOptionsFromHost } from '@/docker/docker-client';
import { assertSessionNetworkSafe } from '@/docker/self-discovery';
import { createRunnerApiServer } from '@/runner-api/runner-api-server';
import { createSecretStore } from '@/secret-store/secret-store';
import { sessionDockerVolumeName } from '@/sessions/container-spec';
import { DeleteNeedsConfirmationError, deleteSession } from '@/sessions/delete-session';
import { listOrphans, reconcile } from '@/sessions/reconcile';
import type { SessionDeps } from '@/sessions/session-deps';
import { restartSession, startSession } from '@/sessions/start-session';
import { stopSession } from '@/sessions/stop-session';
import { CONFIGS_DIR } from './session-test-deps';

/**
 * Real Docker, runc, the runner image with the stub Claude. The runner reaches the panel as
 * http://panel:3100 through a tiny TCP relay container (alias `panel`) to the runner API on the host,
 * and clones from a git daemon container (alias `gitserver`); session containers get no binds.
 */
const enabled = process.env.PANEL_DOCKER_IT === '1';
const RUNNER_DIR = path.join(import.meta.dirname, '..', '..', '..', 'runner');
const BASE_IMAGE = 'claudecloud-runner:test';
const IMAGE = 'claudecloud-runner:panel-it';
const REPO = 'octo/demo';
const tag = randomBytes(4).toString('hex');
const NETWORK = `claudecloud-it-${tag}`;
const AUTH_VOLUME = `claudecloud-it-auth-${tag}`;
const SECRET_LABEL = 'claudecloud.it';

const GIT_SERVER_SCRIPT = [
  'set -e',
  'mkdir -p /srv/git/octo /tmp/work',
  'git init -q -b main /tmp/work',
  'echo "# demo" > /tmp/work/README.md',
  'git -C /tmp/work add README.md',
  'git -C /tmp/work -c user.name=Test -c user.email=t@example.com commit -q -m init',
  'git clone -q --bare /tmp/work /srv/git/octo/demo.git',
  'exec git daemon --reuseaddr --export-all --base-path=/srv/git /srv/git',
].join(' && ');

const relayScript = (port: number) =>
  `require('net').createServer((c) => { const u = require('net').connect(${port}, 'host.docker.internal');` +
  ` c.pipe(u).pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); }).listen(3100);`;

const dockerCli = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 900_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForStatus(db: Db, id: string, status: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    last = row?.status;
    if (row?.status === status) return row;
    if (row?.status === 'failed') throw new Error(`session failed: ${row.statusDetail}`);
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${status} (last ${String(last)})`);
}

const statusCode = (error: unknown) => (error as { statusCode?: number }).statusCode;

describe.skipIf(!enabled)('session orchestrator against local Docker (runc, stub Claude)', () => {
  it(
    'start → working, stop, restart, adopt on panel restart, guarded delete',
    () =>
      withTestDb(async ({ db }) => {
        const docker = new Docker(
          dockerOptionsFromHost(
            process.env.DOCKER_HOST ??
              (process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock'),
          ),
        );
        dockerCli('build', '-q', '-t', BASE_IMAGE, RUNNER_DIR);
        execFileSync('docker', ['build', '-q', '-t', IMAGE, '-'], {
          input: `FROM ${BASE_IMAGE}\nENV CLAUDE_BIN=/opt/runner/test/stub-claude.sh\n`,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const server = createRunnerApiServer({
          db,
          secretStore: createSecretStore({ db, key: randomBytes(32) }),
          mintGitCredential: async () => ({
            username: 'x-access-token',
            password: 'ghs_stub',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        });
        await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
        const port = (server.address() as AddressInfo).port;
        const helpers: Docker.Container[] = [];
        const sessionIds: string[] = [];

        try {
          await docker.createNetwork({ Name: NETWORK, Labels: { [SECRET_LABEL]: tag } });
          await docker.createVolume({ Name: AUTH_VOLUME, Labels: { [SECRET_LABEL]: tag } });
          const helper = async (alias: string, entrypoint: string[], cmd: string[]) => {
            const container = await docker.createContainer({
              Image: IMAGE,
              name: `${NETWORK}-${alias}`,
              Entrypoint: entrypoint,
              Cmd: cmd,
              Labels: { [SECRET_LABEL]: tag },
              HostConfig: { NetworkMode: NETWORK, ExtraHosts: ['host.docker.internal:host-gateway'] },
              NetworkingConfig: { EndpointsConfig: { [NETWORK]: { Aliases: [alias] } } },
            });
            helpers.push(container);
            await container.start();
          };
          await helper('gitserver', ['bash', '-c'], [GIT_SERVER_SCRIPT]);
          await helper('panel', ['node', '-e'], [relayScript(port)]);
          await db.update(settings).set({ cpuPerSession: 1, memoryGbPerSession: 1 });

          const deps: SessionDeps = {
            db,
            docker,
            configsDir: CONFIGS_DIR,
            runtime: 'runc',
            repoUrlTemplate: 'git://gitserver/{owner}/{name}.git',
            discoverStack: async () => ({ networkName: NETWORK, claudeAuthVolume: AUTH_VOLUME, runnerImage: IMAGE }),
            // The real guard against the local engine: the test network holds only the git server and the relay.
            assertSessionNetwork: (network) => assertSessionNetworkSafe(network, docker),
            hasSysbox: () => Promise.reject(new Error('must not be asked with runc')),
            fetchHostStats: async () => null,
            commitIdentity: async () => ({ name: 'Test User', email: 'test@users.noreply.github.com' }),
            resolveRepo: async (fullName) => ({ fullName: fullName.trim(), defaultBranch: 'main' }),
            eventBus: { publish: () => {} },
          };
          const input = {
            repoFullName: REPO,
            baseBranch: 'main',
            profiles: ['frontend'],
            startingTask: 'Fix it 🚀',
            deliveryMode: 'pull_request' as const,
            autoResume: false,
          };

          // start → starting, then working via the runner's events
          const { sessionId: id } = await startSession(input, deps);
          sessionIds.push(id);
          const [fresh] = await db.select().from(sessions).where(eq(sessions.id, id));
          expect(['starting', 'working']).toContain(fresh?.status);
          const working = await waitForStatus(db, id, 'working');
          expect(working.remoteControlUrl).toBe('https://claude.ai/code/session_stub123');
          const containerId = working.containerId!;
          const inspect = await docker.getContainer(containerId).inspect();
          expect(inspect.HostConfig.Privileged).toBe(false);
          expect(inspect.HostConfig.Binds ?? []).toEqual([]);

          // stop → stopped, container kept
          await stopSession(id, deps);
          expect((await db.select().from(sessions).where(eq(sessions.id, id)))[0]?.status).toBe('stopped');
          expect((await docker.getContainer(containerId).inspect()).State.Running).toBe(false);

          // restart → working again (runner resumes with --continue)
          await restartSession(id, deps);
          await waitForStatus(db, id, 'working');

          // panel restart: fresh in-memory deps, reconcile adopts the running container as is
          const before = (await db.select().from(sessions).where(eq(sessions.id, id)))[0]!;
          await reconcile({ ...deps, eventBus: { publish: () => {} } });
          const after = (await db.select().from(sessions).where(eq(sessions.id, id)))[0]!;
          expect(after).toMatchObject({ status: 'working', containerId, secretHash: before.secretHash });
          const labeled = await docker.listContainers({ all: true, filters: { label: [`claudecloud.session=${id}`] } });
          expect(labeled.map((c) => c.Id)).toEqual([containerId]);

          // an unpushed commit blocks an unconfirmed delete
          dockerCli('exec', '-u', 'claude', containerId, 'git', '-C', '/workspace/repo', 'commit', '-q', '--allow-empty', '-m', 'wip');
          const unpushed = await deleteSession(id, {}, deps).catch((e: unknown) => e);
          expect(unpushed).toBeInstanceOf(DeleteNeedsConfirmationError);
          expect((unpushed as DeleteNeedsConfirmationError).gitState).toMatchObject({ unpushedCommits: 1, uncommittedFiles: 0 });
          expect((unpushed as DeleteNeedsConfirmationError).gitState.error).toBeUndefined();

          // container gone: reconcile marks it stopped; the git state is unknown and needs the typed name
          dockerCli('rm', '-f', containerId);
          await reconcile(deps);
          expect((await db.select().from(sessions).where(eq(sessions.id, id)))[0]).toMatchObject({
            status: 'stopped',
            statusDetail: 'container missing',
          });
          const unknown = await deleteSession(id, {}, deps).catch((e: unknown) => e);
          expect(unknown).toBeInstanceOf(DeleteNeedsConfirmationError);
          expect((unknown as DeleteNeedsConfirmationError).gitState.error).toBeTruthy();
          await expect(deleteSession(id, { typedRepoName: 'octo/other' }, deps)).rejects.toBeInstanceOf(
            DeleteNeedsConfirmationError,
          );
          await deleteSession(id, { typedRepoName: REPO }, deps);
          expect((await db.select().from(sessions).where(eq(sessions.id, id)))[0]?.deletedAt).toBeInstanceOf(Date);
          await expect(docker.getVolume(sessionDockerVolumeName(id)).inspect()).rejects.toSatisfy(
            (e: unknown) => statusCode(e) === 404,
          );

          // a clean workspace deletes without typing; container and volume are gone
          const { sessionId: clean } = await startSession({ ...input, startingTask: null }, deps);
          sessionIds.push(clean);
          const cleanRow = await waitForStatus(db, clean, 'working');
          await deleteSession(clean, {}, deps);
          await expect(docker.getContainer(cleanRow.containerId!).inspect()).rejects.toSatisfy(
            (e: unknown) => statusCode(e) === 404,
          );
          await expect(docker.getVolume(sessionDockerVolumeName(clean)).inspect()).rejects.toSatisfy(
            (e: unknown) => statusCode(e) === 404,
          );

          // a failed session's container is stopped by reconcile (unless-stopped would loop it forever)
          const { sessionId: broken } = await startSession({ ...input, startingTask: null }, deps);
          sessionIds.push(broken);
          const brokenRow = await waitForStatus(db, broken, 'working');
          await db.update(sessions).set({ status: 'failed', statusDetail: 'clone: boom' }).where(eq(sessions.id, broken));
          await reconcile(deps);
          const brokenState = (await docker.getContainer(brokenRow.containerId!).inspect()).State;
          expect(brokenState.Running).toBe(false);
          expect(brokenState.Restarting).toBe(false);
          await sleep(3_000);
          expect((await docker.getContainer(brokenRow.containerId!).inspect()).State.Running).toBe(false);
          expect((await db.select().from(sessions).where(eq(sessions.id, broken)))[0]?.status).toBe('failed');

          // a labeled container without a live row is an orphan, listed and left alone
          const orphan = await docker.createContainer({
            Image: IMAGE,
            name: `${NETWORK}-orphan`,
            Labels: { 'claudecloud.session': id, 'claudecloud.role': 'session', [SECRET_LABEL]: tag },
          });
          helpers.push(orphan);
          expect((await listOrphans(deps)).map((o) => o.containerId)).toContain(orphan.id);
          await reconcile(deps);
          expect((await orphan.inspect()).Id).toBe(orphan.id);
        } finally {
          // Only what this test created: its helpers, its sessions' containers and volumes, its network.
          for (const container of helpers) await container.remove({ force: true }).catch(() => undefined);
          for (const id of sessionIds) {
            const left = await docker.listContainers({ all: true, filters: { label: [`claudecloud.session=${id}`] } });
            for (const c of left) await docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined);
            await docker.getVolume(sessionDockerVolumeName(id)).remove().catch(() => undefined);
          }
          await docker.getVolume(AUTH_VOLUME).remove().catch(() => undefined);
          await docker.getNetwork(NETWORK).remove().catch(() => undefined);
          await new Promise((r) => {
            server.closeAllConnections();
            server.close(r);
          });
        }
      }),
    600_000,
  );
});
