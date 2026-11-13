import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { docker } from '@/docker/docker-client';
import { getPanelEnv } from '@/env/panel-env';

export type StackInfo = { networkName: string; claudeAuthVolume: string; runnerImage: string };

export type StackDiscoveryEnv = {
  stackNetwork: string | null;
  claudeAuthVolume: string | null;
  runnerImage: string;
};

/** The slice of `docker inspect` the discovery reads. */
export type SelfInspect = {
  Config?: { Labels?: Record<string, string> | null };
  Mounts?: { Type?: string; Name?: string; Destination?: string }[];
  NetworkSettings?: { Networks?: Record<string, unknown> };
};

export class StackDiscoveryError extends Error {
  override name = 'StackDiscoveryError';
}

const CLAUDE_AUTH_MOUNT = '/claude-auth';
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const COMPOSE_NETWORK_LABEL = 'com.docker.compose.network';
/** The compose network key (docker-compose.yml `networks: sessions`) that session containers join. */
export const SESSIONS_NETWORK_KEY = 'sessions';

/**
 * `sessionsNetworks`: names of the networks labelled `com.docker.compose.network=sessions` in the panel's own
 * compose project, or null when that lookup was impossible (no project label, the proxy forbids listing).
 * Sessions only ever join that network: never one merely shared with postgres or the socket proxy.
 */
export function pickStackInfo(
  selfInspect: SelfInspect | null,
  env: StackDiscoveryEnv,
  sessionsNetworks: ReadonlySet<string> | null = null,
): StackInfo {
  return {
    networkName: env.stackNetwork ?? pickNetwork(selfInspect, sessionsNetworks),
    claudeAuthVolume: env.claudeAuthVolume ?? pickAuthVolume(selfInspect),
    runnerImage: env.runnerImage,
  };
}

function pickNetwork(selfInspect: SelfInspect | null, sessionsNetworks: ReadonlySet<string> | null): string {
  if (!selfInspect) {
    throw new StackDiscoveryError('Cannot inspect own container; set STACK_NETWORK');
  }
  if (!sessionsNetworks) {
    throw new StackDiscoveryError(
      `Cannot look up the "${SESSIONS_NETWORK_KEY}" network of this compose project; set STACK_NETWORK`,
    );
  }
  const own = Object.keys(selfInspect.NetworkSettings?.Networks ?? {}).filter((name) => sessionsNetworks.has(name));
  if (own.length === 1) return own[0]!;
  throw new StackDiscoveryError(
    own.length === 0
      ? `The panel is not on a "${SESSIONS_NETWORK_KEY}" network of its compose project; set STACK_NETWORK`
      : `The "${SESSIONS_NETWORK_KEY}" network is ambiguous (${own.join(', ')}); set STACK_NETWORK`,
  );
}

/** The slice of a container listing the network guard reads. */
export type NetworkPeer = {
  Names?: string[];
  Labels?: Record<string, string> | null;
  Mounts?: { Source?: string; Destination?: string }[];
};

const DOCKER_SOCKET = /(^|\/)docker\.sock$/;
/** Compose services that must never share a network with a session container. */
const FORBIDDEN_SERVICES = new Set(['docker-proxy', 'postgres']);

/**
 * Containers on a would-be session network that a session must never reach: the Docker socket proxy (root
 * on the host), anything with the Docker socket mounted, and the database. The panel itself is expected.
 */
export function unsafeNetworkPeers(peers: readonly NetworkPeer[]): string[] {
  return peers.flatMap((peer) => {
    const service = peer.Labels?.[COMPOSE_SERVICE_LABEL];
    const name = service ?? peer.Names?.[0]?.replace(/^\//, '') ?? 'unnamed container';
    if (service && FORBIDDEN_SERVICES.has(service)) return [name];
    const mountsSocket = (peer.Mounts ?? []).some(
      (mount) => DOCKER_SOCKET.test(mount.Source ?? '') || DOCKER_SOCKET.test(mount.Destination ?? ''),
    );
    return mountsSocket ? [`${name} (mounts docker.sock)`] : [];
  });
}

/**
 * Hard guard before any session container is created or started: refuses when the target network also
 * holds the socket proxy, a docker.sock mount or postgres. Applies to an explicit STACK_NETWORK too, and
 * fails closed when the network cannot be listed.
 */
export async function assertSessionNetworkSafe(
  networkName: string,
  client: Pick<typeof docker, 'listContainers'> = docker,
): Promise<void> {
  let peers: NetworkPeer[];
  try {
    peers = (await client.listContainers({ all: true, filters: { network: [networkName] } })) as NetworkPeer[];
  } catch (cause) {
    throw new StackDiscoveryError(
      `Cannot check who else is on network "${networkName}" (${describeError(cause)}); sessions were not started`,
      { cause },
    );
  }
  const unsafe = unsafeNetworkPeers(peers);
  if (unsafe.length > 0) {
    throw new StackDiscoveryError(
      `Refusing to put sessions on network "${networkName}": it also holds ${unsafe.join(', ')}. Sessions may only ` +
        `share a network with the panel; use the stack's "${SESSIONS_NETWORK_KEY}" network (or fix STACK_NETWORK).`,
    );
  }
}

function pickAuthVolume(selfInspect: SelfInspect | null): string {
  if (!selfInspect) {
    throw new StackDiscoveryError(
      `Cannot inspect own container; set CLAUDE_AUTH_VOLUME (mounted at ${CLAUDE_AUTH_MOUNT})`,
    );
  }
  const mount = selfInspect.Mounts?.find((m) => m.Destination === CLAUDE_AUTH_MOUNT && m.Name);
  if (!mount?.Name) {
    throw new StackDiscoveryError(`No named volume mounted at ${CLAUDE_AUTH_MOUNT}; set CLAUDE_AUTH_VOLUME`);
  }
  return mount.Name;
}

/** Container id from /proc/self/mountinfo (`.../containers/<id>/hostname`) or a cgroup path. */
export function containerIdFromProc(text: string): string | null {
  const match =
    /\/containers\/([0-9a-f]{64})\//.exec(text) ??
    /\/docker\/([0-9a-f]{64})(?:\/|$|\s)/m.exec(text) ??
    /docker-([0-9a-f]{64})\.scope/.exec(text);
  return match?.[1] ?? null;
}

async function readOwnContainerId(): Promise<string | null> {
  for (const file of ['/proc/self/mountinfo', '/proc/self/cgroup']) {
    try {
      // A fixed /proc path, never a project file: keep it out of the standalone output trace.
      const id = containerIdFromProc(await readFile(/* turbopackIgnore: true */ file, 'utf8'));
      if (id) return id;
    } catch {
      // not Linux / not readable: try the next source
    }
  }
  return null;
}

function describeError(error: unknown): string {
  const status = (error as { statusCode?: unknown }).statusCode;
  const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
  return typeof status === 'number' ? `HTTP ${status}: ${message}` : message;
}

async function inspectSelf(): Promise<SelfInspect> {
  try {
    return (await docker.getContainer(hostname()).inspect()) as SelfInspect;
  } catch (error) {
    if ((error as { statusCode?: unknown }).statusCode !== 404) throw error;
    const id = await readOwnContainerId();
    if (!id) throw error;
    return (await docker.getContainer(id).inspect()) as SelfInspect;
  }
}

/** Networks labelled as this compose project's `sessions` network; null if listing is not possible. */
async function findSessionsNetworks(self: SelfInspect): Promise<Set<string> | null> {
  const project = self.Config?.Labels?.[COMPOSE_PROJECT_LABEL];
  if (!project) return null;
  try {
    const networks = await docker.listNetworks({
      filters: { label: [`${COMPOSE_PROJECT_LABEL}=${project}`, `${COMPOSE_NETWORK_LABEL}=${SESSIONS_NETWORK_KEY}`] },
    });
    return new Set(networks.map((network) => network.Name));
  } catch {
    return null;
  }
}

let cached: Promise<StackInfo> | undefined;

/** Inspects the panel's own container (hostname = container id). Memoised; failures are not cached. */
export function discoverStack(): Promise<StackInfo> {
  cached ??= resolveStack().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

export function resetStackCache(): void {
  cached = undefined;
}

async function resolveStack(): Promise<StackInfo> {
  const env = getPanelEnv();
  const stackEnv: StackDiscoveryEnv = {
    stackNetwork: env.stackNetwork,
    claudeAuthVolume: env.claudeAuthVolume,
    runnerImage: env.runnerImage,
  };
  if (stackEnv.stackNetwork && stackEnv.claudeAuthVolume) return pickStackInfo(null, stackEnv);
  let self: SelfInspect;
  try {
    self = await inspectSelf();
  } catch (cause) {
    // Not in a container (local dev) or the proxy forbids inspect: env must cover it.
    try {
      return pickStackInfo(null, stackEnv);
    } catch (error) {
      if (error instanceof StackDiscoveryError) {
        throw new StackDiscoveryError(`${error.message} (own container inspect failed: ${describeError(cause)})`, {
          cause,
        });
      }
      throw error;
    }
  }
  const sessionsNetworks = stackEnv.stackNetwork ? null : await findSessionsNetworks(self);
  return pickStackInfo(self, stackEnv, sessionsNetworks);
}
