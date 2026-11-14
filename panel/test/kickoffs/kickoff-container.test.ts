import type Dockerode from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { removeStaleKickoffContainers, runKickoffContainer, type KickoffContainerDeps } from '@/kickoffs/kickoff-container';

const STACK = { networkName: 'sessions-net', claudeAuthVolume: 'auth-vol', runnerImage: 'runner:test' };

function fakeDeps(wait: () => Promise<{ StatusCode: number }>) {
  const container = {
    start: vi.fn(async () => undefined),
    wait: vi.fn(wait),
    remove: vi.fn(async () => undefined),
  };
  const createContainer = vi.fn(async (_spec: unknown) => container);
  const deps: KickoffContainerDeps = {
    docker: { createContainer } as unknown as KickoffContainerDeps['docker'],
    discoverStack: async () => STACK,
    timeoutMs: 50,
  };
  return { deps, container, createContainer };
}

describe('runKickoffContainer', () => {
  it('creates the container with the auth volume and kickoff label', async () => {
    const { deps, createContainer, container } = fakeDeps(async () => ({ StatusCode: 0 }));
    await expect(runKickoffContainer(deps)).resolves.toEqual({ ok: true });
    expect(createContainer).toHaveBeenCalledOnce();
    const spec = createContainer.mock.calls[0]![0] as Dockerode.ContainerCreateOptions;
    expect(spec.Image).toBe('runner:test');
    expect(spec.Entrypoint).toEqual(['/opt/runner/kickoff.sh']);
    expect(spec.User).toBe('1000:1000');
    expect(spec.Labels).toEqual({ 'claudecloud.role': 'kickoff' });
    expect(spec.HostConfig?.Mounts).toEqual([{ Type: 'volume', Source: 'auth-vol', Target: '/claude-auth' }]);
    expect(spec.HostConfig?.NetworkMode).toBe('sessions-net');
    expect(container.start).toHaveBeenCalledOnce();
  });

  it('removes the container on success, failure and timeout', async () => {
    const ok = fakeDeps(async () => ({ StatusCode: 0 }));
    await runKickoffContainer(ok.deps);
    expect(ok.container.remove).toHaveBeenCalledWith({ force: true });

    const failed = fakeDeps(async () => ({ StatusCode: 3 }));
    await expect(runKickoffContainer(failed.deps)).resolves.toEqual({ ok: false, reason: 'Claude exited with code 3' });
    expect(failed.container.remove).toHaveBeenCalledWith({ force: true });

    const hung = fakeDeps(() => new Promise(() => undefined));
    await expect(runKickoffContainer(hung.deps)).resolves.toEqual({ ok: false, reason: 'Timed out after 2 minutes' });
    expect(hung.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('reports a container that cannot start', async () => {
    const { deps, container } = fakeDeps(async () => ({ StatusCode: 0 }));
    container.start.mockRejectedValueOnce(new Error('boom'));
    await expect(runKickoffContainer(deps)).resolves.toEqual({ ok: false, reason: 'Could not start the container' });
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('runs one at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = fakeDeps(async () => {
      await gate;
      return { StatusCode: 0 };
    });
    const second = fakeDeps(async () => ({ StatusCode: 0 }));
    first.deps.timeoutMs = second.deps.timeoutMs = 5000;

    const a = runKickoffContainer(first.deps);
    const b = runKickoffContainer(second.deps);
    await vi.waitFor(() => expect(first.container.start).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.createContainer).not.toHaveBeenCalled();
    release();
    await Promise.all([a, b]);
    expect(second.createContainer).toHaveBeenCalledOnce();
  });
});

describe('removeStaleKickoffContainers', () => {
  it('force-removes labelled containers and counts them', async () => {
    const remove = vi.fn(async () => undefined);
    const dockerLike = {
      listContainers: vi.fn(async () => [{ Id: 'a' }, { Id: 'b' }]),
      getContainer: vi.fn(() => ({ remove })),
    };
    await expect(removeStaleKickoffContainers({ docker: dockerLike as never })).resolves.toBe(2);
    expect(dockerLike.listContainers).toHaveBeenCalledWith({ all: true, filters: { label: ['claudecloud.role=kickoff'] } });
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
