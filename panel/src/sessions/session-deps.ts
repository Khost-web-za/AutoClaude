import type Docker from 'dockerode';
import { db as sharedDb, type Db } from '@/db/client';
import { docker as sharedDocker } from '@/docker/docker-client';
import { assertSessionNetworkSafe, discoverStack, type StackInfo } from '@/docker/self-discovery';
import { hasSysbox } from '@/docker/sysbox-check';
import { getPanelEnv } from '@/env/panel-env';
import { sharedGithubDeps } from '@/github/github-deps';
import { resolveCommitIdentity } from '@/github/user-auth';
import { fetchHostStats } from '@/host/host-stats';
import type { HostStats } from '@/host/host-stats-types';
import { eventBus as sharedEventBus, type EventBus } from '@/live/event-bus';
import { assertRepoAccessible } from '@/repos/repo-access';

export type SessionDocker = Pick<
  Docker,
  'createContainer' | 'getContainer' | 'getVolume' | 'listContainers' | 'info' | 'modem'
>;

/** Everything the orchestrator touches, injectable so tests bind a test DB, a fake Docker or a local engine. */
export type SessionDeps = {
  db: Db;
  docker: SessionDocker;
  configsDir: string;
  /** SESSION_RUNTIME: `sysbox-runc` in production, `runc` in tests. */
  runtime: string;
  repoUrlTemplate: string | null;
  discoverStack: () => Promise<StackInfo>;
  /** Rejects (StackDiscoveryError) when the network also holds the socket proxy, docker.sock or postgres. */
  assertSessionNetwork: (networkName: string) => Promise<void>;
  /** May reject when the daemon cannot be asked (R14); only called for `sysbox-runc`. */
  hasSysbox: () => Promise<boolean>;
  /** Host free disk etc.; null when unavailable (the disk check is then skipped). */
  fetchHostStats: () => Promise<HostStats | null>;
  commitIdentity: () => Promise<{ name: string; email: string }>;
  /**
   * The repository as the GitHub App sees it: GitHub's canonical `Owner/Name` casing (the key repo secrets,
   * repo settings and the repo Sessions tab use) and its default branch. Rejects one the App cannot see.
   */
  resolveRepo: (repoFullName: string) => Promise<{ fullName: string; defaultBranch: string }>;
  eventBus: Pick<EventBus, 'publish'>;
};

export function sharedSessionDeps(): SessionDeps {
  const env = getPanelEnv();
  return {
    db: sharedDb,
    docker: sharedDocker,
    configsDir: env.configsDir,
    runtime: env.sessionRuntime,
    repoUrlTemplate: env.sessionRepoUrlTemplate,
    discoverStack,
    assertSessionNetwork: assertSessionNetworkSafe,
    hasSysbox: () => hasSysbox(),
    fetchHostStats,
    commitIdentity: () => resolveCommitIdentity(sharedGithubDeps()),
    resolveRepo: (repoFullName) => assertRepoAccessible(repoFullName),
    eventBus: sharedEventBus,
  };
}
