import type Dockerode from 'dockerode';
import { docker as defaultDocker } from '@/docker/docker-client';
import { discoverStack, type StackInfo } from '@/docker/self-discovery';

const ROLE_LABEL = 'claudecloud.role';
const KICKOFF_ROLE = 'kickoff';
const KICKOFF_SCRIPT = '/opt/runner/kickoff.sh';
const TIMEOUT_MS = 2 * 60 * 1000;

export type KickoffContainerResult = { ok: true } | { ok: false; reason: string };

export type KickoffContainerDeps = {
  docker: Pick<Dockerode, 'createContainer'>;
  discoverStack: () => Promise<StackInfo>;
  timeoutMs: number;
};

const defaultDeps = (): KickoffContainerDeps => ({
  docker: defaultDocker,
  discoverStack,
  timeoutMs: TIMEOUT_MS,
});

// One kick-off container at a time: queued callers wait for the previous run to finish.
let lock: Promise<unknown> = Promise.resolve();

/**
 * Runs real Claude Code once (`claude -p "."`) in a short-lived runner container so a fresh usage window starts.
 * The container only sees the shared auth volume; its output is never read, so `reason` is one of three fixed strings.
 */
export function runKickoffContainer(overrides: Partial<KickoffContainerDeps> = {}): Promise<KickoffContainerResult> {
  const run = lock.then(() => runUnlocked({ ...defaultDeps(), ...overrides }));
  lock = run.catch(() => undefined);
  return run;
}

async function runUnlocked(deps: KickoffContainerDeps): Promise<KickoffContainerResult> {
  let container: Dockerode.Container | undefined;
  try {
    const stack = await deps.discoverStack();
    container = await deps.docker.createContainer({
      Image: stack.runnerImage,
      Entrypoint: [KICKOFF_SCRIPT],
      User: '1000:1000',
      Labels: { [ROLE_LABEL]: KICKOFF_ROLE },
      HostConfig: {
        Mounts: [{ Type: 'volume', Source: stack.claudeAuthVolume, Target: '/claude-auth' }],
        NetworkMode: stack.networkName,
      },
    });
    await container.start();
  } catch {
    if (container) await removeContainer(container);
    return { ok: false, reason: 'Could not start the container' };
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), deps.timeoutMs);
    });
    const outcome = await Promise.race([container.wait(), timedOut]);
    if (outcome === 'timeout') return { ok: false, reason: 'Timed out after 2 minutes' };
    return outcome.StatusCode === 0 ? { ok: true } : { ok: false, reason: `Claude exited with code ${outcome.StatusCode}` };
  } catch {
    return { ok: false, reason: 'Could not start the container' };
  } finally {
    clearTimeout(timer);
    await removeContainer(container);
  }
}

async function removeContainer(container: Dockerode.Container): Promise<void> {
  await container.remove({ force: true }).catch(() => undefined);
}

/** Force-removes kick-off containers left behind by a crashed or redeployed panel. */
export async function removeStaleKickoffContainers(
  deps: { docker: Pick<Dockerode, 'listContainers' | 'getContainer'> } = { docker: defaultDocker },
): Promise<number> {
  const stale = await deps.docker.listContainers({ all: true, filters: { label: [`${ROLE_LABEL}=${KICKOFF_ROLE}`] } });
  await Promise.all(stale.map((info) => removeContainer(deps.docker.getContainer(info.Id))));
  return stale.length;
}
