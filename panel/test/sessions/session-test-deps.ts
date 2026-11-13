import path from 'node:path';
import type { Readable } from 'node:stream';
import type Docker from 'dockerode';
import type { Db } from '@/db/client';
import { settings } from '@/db/schema';
import type { SessionDeps, SessionDocker } from '@/sessions/session-deps';

export const CONFIGS_DIR = path.join(import.meta.dirname, '..', 'fixtures', 'configs');

export type FakeDockerOptions = {
  /** Container start rejects. */
  failStart?: boolean;
  /** Container remove rejects. */
  failRemove?: boolean;
  /** Runs inside createContainer, after the container "exists". */
  onCreate?: () => Promise<void>;
  /** Runs inside container start, after it "started". */
  onStart?: () => Promise<void>;
  /** What listContainers returns; `onList` runs before it answers. */
  containers?: Pick<Docker.ContainerInfo, 'Id' | 'Names' | 'Labels' | 'State'>[];
  onList?: () => Promise<void>;
};

/** Records what the orchestrator asks of Docker. */
export function fakeDocker(options: FakeDockerOptions = {}) {
  const calls: string[] = [];
  let next = 0;
  const handle = (id: string) => ({
    id,
    start: async () => void calls.push(`start ${id}`),
    restart: async () => void calls.push(`restart ${id}`),
    inspect: async () => ({ NetworkSettings: { Networks: { net: {} } } }),
    stop: async () => void calls.push(`stop ${id}`),
    remove: async () => {
      calls.push(`remove ${id}`);
      if (options.failRemove) throw Object.assign(new Error('busy'), { statusCode: 500 });
    },
  });
  const docker = {
    info: async () => ({ Driver: 'overlay2', DriverStatus: [['Backing Filesystem', 'extfs']] }),
    createContainer: async (spec: Docker.ContainerCreateOptions) => {
      const id = `fake-${(next += 1)}`;
      calls.push(`create ${spec.name}`);
      await options.onCreate?.();
      return {
        ...handle(id),
        putArchive: async (stream: Readable) => {
          stream.resume();
          calls.push(`putArchive ${id}`);
        },
        start: async () => {
          calls.push(`start ${id}`);
          if (options.failStart) throw Object.assign(new Error('boom'), { statusCode: 500, json: { message: 'no such runtime' } });
          await options.onStart?.();
        },
      };
    },
    getContainer: (id: string) => handle(id),
    getVolume: (name: string) => ({ remove: async () => void calls.push(`removeVolume ${name}`) }),
    listContainers: async () => {
      await options.onList?.();
      return options.containers ?? [];
    },
  } as unknown as SessionDocker;
  return { docker, calls };
}

export function testDeps(db: Db, overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    db,
    docker: fakeDocker().docker,
    configsDir: CONFIGS_DIR,
    runtime: 'runc',
    repoUrlTemplate: null,
    discoverStack: async () => ({ networkName: 'net', claudeAuthVolume: 'auth', runnerImage: 'runner:test' }),
    assertSessionNetwork: async () => {},
    hasSysbox: async () => true,
    fetchHostStats: async () => null,
    commitIdentity: async () => ({ name: 'Test', email: 'test@example.com' }),
    resolveRepo: async (fullName) => ({ fullName: fullName.trim(), defaultBranch: 'main' }),
    eventBus: { publish: () => {} },
    ...overrides,
  };
}

export const setMaxRunning = (db: Db, maxRunning: number) => db.update(settings).set({ maxRunning });
