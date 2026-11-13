import { beforeEach, describe, expect, it, vi } from 'vitest';
import selfInspect from '../fixtures/docker/self-inspect.json';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  getContainer: vi.fn(),
  listContainers: vi.fn(),
  listNetworks: vi.fn(),
  readFile: vi.fn(),
  env: { stackNetwork: null as string | null, claudeAuthVolume: null as string | null, runnerImage: 'r:1' },
}));
vi.mock('@/docker/docker-client', () => ({
  docker: { getContainer: mocks.getContainer, listContainers: mocks.listContainers, listNetworks: mocks.listNetworks },
}));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@/env/panel-env', () => ({ getPanelEnv: () => mocks.env }));

import {
  assertSessionNetworkSafe,
  containerIdFromProc,
  discoverStack,
  resetStackCache,
  StackDiscoveryError,
} from '@/docker/self-discovery';

const ID = 'a'.repeat(63) + 'b';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env = { stackNetwork: null, claudeAuthVolume: null, runnerImage: 'r:1' };
  mocks.getContainer.mockReturnValue({ inspect: mocks.inspect });
  resetStackCache();
});

describe('containerIdFromProc', () => {
  it('reads the id from mountinfo and cgroup text', () => {
    expect(
      containerIdFromProc(`512 498 0:49 /var/lib/docker/containers/${ID}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`),
    ).toBe(ID);
    expect(containerIdFromProc(`0::/system.slice/docker-${ID}.scope`)).toBe(ID);
    expect(containerIdFromProc(`12:cpu:/docker/${ID}`)).toBe(ID);
    expect(containerIdFromProc('nothing here')).toBeNull();
  });
});

describe('discoverStack', () => {
  it('selects the network labelled com.docker.compose.network=sessions in its own project', async () => {
    const inspect = {
      ...selfInspect,
      Config: { Labels: { 'com.docker.compose.project': 'proj' } },
      NetworkSettings: { Networks: { coolify: {}, proj: {}, proj_sessions: {} } },
    };
    mocks.inspect.mockResolvedValue(inspect);
    mocks.listNetworks.mockResolvedValue([{ Name: 'proj_sessions' }]);
    const info = await discoverStack();
    expect(info.networkName).toBe('proj_sessions');
    expect(mocks.listNetworks).toHaveBeenCalledWith({
      filters: { label: ['com.docker.compose.project=proj', 'com.docker.compose.network=sessions'] },
    });
  });

  it('refuses to guess when the network listing is forbidden', async () => {
    mocks.inspect.mockResolvedValue({ ...selfInspect, Config: { Labels: { 'com.docker.compose.project': 'p' } } });
    mocks.listNetworks.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    await expect(discoverStack()).rejects.toThrow(/STACK_NETWORK/);
  });

  it('falls back to the id from /proc when the hostname lookup 404s', async () => {
    mocks.getContainer.mockImplementation((id: string) => ({
      inspect: id === ID ? async () => selfInspect : async () => Promise.reject(Object.assign(new Error('x'), { statusCode: 404 })),
    }));
    mocks.env = { ...mocks.env, stackNetwork: 'net' };
    mocks.readFile.mockResolvedValue(
      `1 2 0:1 /var/lib/docker/containers/${ID}/hostname /etc/hostname rw - ext4 d rw`,
    );
    await expect(discoverStack()).resolves.toMatchObject({ claudeAuthVolume: 'x0k8s4c0gwsk0ow4cgcg8wkw_claude-auth' });
  });

  it('keeps the actionable message and the underlying cause when inspect fails', async () => {
    const cause = Object.assign(new Error('Forbidden by proxy'), { statusCode: 403 });
    mocks.inspect.mockRejectedValue(cause);
    const error = await discoverStack().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StackDiscoveryError);
    expect((error as Error).message).toMatch(/STACK_NETWORK.*HTTP 403/);
    expect((error as Error).cause).toBe(cause);
  });

  it('does not cache failures but does cache successes', async () => {
    mocks.env = { ...mocks.env, stackNetwork: 'net' };
    mocks.inspect.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(selfInspect);
    await expect(discoverStack()).rejects.toThrow(StackDiscoveryError);
    const first = await discoverStack();
    const second = await discoverStack();
    expect(second).toBe(first);
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
  });
});

describe('assertSessionNetworkSafe', () => {
  const panel = { Names: ['/panel'], Labels: { 'com.docker.compose.service': 'panel' }, Mounts: [] };

  it('passes a network that holds only the panel and sessions, and lists stopped containers too', async () => {
    mocks.listContainers.mockResolvedValue([panel, { Names: ['/claudecloud-session-ab12'], Labels: {} }]);
    await expect(assertSessionNetworkSafe('proj_sessions')).resolves.toBeUndefined();
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: true, filters: { network: ['proj_sessions'] } });
  });

  it('refuses when docker-proxy is attached', async () => {
    mocks.listContainers.mockResolvedValue([panel, { Names: ['/p'], Labels: { 'com.docker.compose.service': 'docker-proxy' } }]);
    await expect(assertSessionNetworkSafe('uuid')).rejects.toThrow(StackDiscoveryError);
    await expect(assertSessionNetworkSafe('uuid')).rejects.toThrow(/docker-proxy/);
  });

  it('refuses when any attached container mounts docker.sock', async () => {
    mocks.listContainers.mockResolvedValue([
      panel,
      { Names: ['/agent'], Labels: {}, Mounts: [{ Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' }] },
    ]);
    await expect(assertSessionNetworkSafe('uuid')).rejects.toThrow('agent (mounts docker.sock)');
  });

  it('applies to an explicit STACK_NETWORK as well: the override is still checked', async () => {
    mocks.env = { ...mocks.env, stackNetwork: 'uuid', claudeAuthVolume: 'auth' };
    const { networkName } = await discoverStack();
    expect(networkName).toBe('uuid');
    mocks.listContainers.mockResolvedValue([panel, { Names: ['/db'], Labels: { 'com.docker.compose.service': 'postgres' } }]);
    await expect(assertSessionNetworkSafe(networkName)).rejects.toThrow(/Refusing to put sessions on network "uuid".*postgres/);
  });

  it('fails closed when the network cannot be listed', async () => {
    mocks.listContainers.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 403 }));
    await expect(assertSessionNetworkSafe('x')).rejects.toThrow(StackDiscoveryError);
  });
});
