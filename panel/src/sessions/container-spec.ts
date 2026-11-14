import type Docker from 'dockerode';
import type { DeliveryMode } from '@/db/schema';
import { sessionShortId } from './work-branch';

/** The panel's internal runner API, reached over the stack network (never published). */
export const SESSION_PANEL_URL = 'http://panel:3100';
export const SESSION_LABEL = 'claudecloud.session';
export const ROLE_LABEL = 'claudecloud.role';
export const SESSION_ROLE = 'session';
const GB = 1024 ** 3;

export type ContainerSpecInput = {
  sessionId: string;
  secret: string;
  repoFullName: string;
  baseBranch: string;
  defaultBranch: string;
  workBranch: string;
  startingTask: string | null;
  gitAuthor: { name: string; email: string };
  runnerImage: string;
  networkName: string;
  claudeAuthVolume: string;
  runtime: string;
  /** e2e only: `{owner}` / `{name}` are substituted to form REPO_URL. */
  repoUrlTemplate: string | null;
  cpus: number;
  memoryGb: number;
  diskGb: number;
  storageOptSupported: boolean;
  deliveryMode: DeliveryMode;
};

export const sessionContainerName = (sessionId: string) => `claudecloud-session-${sessionShortId(sessionId)}`;
export const sessionDockerVolumeName = (sessionId: string) => `claudecloud-session-${sessionShortId(sessionId)}-docker`;

/**
 * Whether `HostConfig.StorageOpt.size` is enforceable on this daemon. Overlay2 needs xfs (with pquota,
 * which the daemon does not report; a create that still rejects it is retried without the option).
 */
export function supportsStorageOpt(info: { Driver?: string; DriverStatus?: unknown }): boolean {
  if (info.Driver === 'btrfs' || info.Driver === 'zfs') return true;
  if (info.Driver !== 'overlay2' || !Array.isArray(info.DriverStatus)) return false;
  return info.DriverStatus.some(
    (entry) => Array.isArray(entry) && entry[0] === 'Backing Filesystem' && entry[1] === 'xfs',
  );
}

function repoUrl(template: string, repoFullName: string): string {
  const [owner = '', name = ''] = repoFullName.split('/');
  return template.replaceAll('{owner}', owner).replaceAll('{name}', name);
}

/** The session container, exactly per docs/runner-contract.md. Pure. */
export function buildContainerSpec(input: ContainerSpecInput): Docker.ContainerCreateOptions {
  const env: string[] = [
    `SESSION_ID=${input.sessionId}`,
    `SESSION_SECRET=${input.secret}`,
    `PANEL_URL=${SESSION_PANEL_URL}`,
    `REPO_FULL_NAME=${input.repoFullName}`,
    ...(input.repoUrlTemplate ? [`REPO_URL=${repoUrl(input.repoUrlTemplate, input.repoFullName)}`] : []),
    `BASE_BRANCH=${input.baseBranch}`,
    `DEFAULT_BRANCH=${input.defaultBranch}`,
    `WORK_BRANCH=${input.workBranch}`,
    ...(input.startingTask
      ? [`STARTING_TASK_B64=${Buffer.from(input.startingTask, 'utf8').toString('base64')}`]
      : []),
    `GIT_AUTHOR_NAME=${input.gitAuthor.name}`,
    `GIT_AUTHOR_EMAIL=${input.gitAuthor.email}`,
    ...(input.runtime === 'sysbox-runc' ? ['SESSION_DOCKER=true'] : []),
    `DELIVERY_MODE=${input.deliveryMode}`,
  ];

  return {
    name: sessionContainerName(input.sessionId),
    Image: input.runnerImage,
    Labels: { [SESSION_LABEL]: input.sessionId, [ROLE_LABEL]: SESSION_ROLE },
    Env: env,
    HostConfig: {
      Runtime: input.runtime,
      NanoCpus: Math.round(input.cpus * 1e9),
      Memory: Math.round(input.memoryGb * GB),
      Mounts: [
        { Type: 'volume', Source: input.claudeAuthVolume, Target: '/claude-auth' },
        { Type: 'volume', Source: sessionDockerVolumeName(input.sessionId), Target: '/var/lib/docker' },
      ],
      NetworkMode: input.networkName,
      RestartPolicy: { Name: 'unless-stopped' },
      ...(input.storageOptSupported ? { StorageOpt: { size: `${input.diskGb}G` } } : {}),
    },
  };
}
