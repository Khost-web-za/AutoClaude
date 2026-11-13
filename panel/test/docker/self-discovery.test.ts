import { describe, expect, it } from 'vitest';
import selfInspect from '../fixtures/docker/self-inspect.json';
import { pickStackInfo, StackDiscoveryError, unsafeNetworkPeers } from '@/docker/self-discovery';

const noEnv = { stackNetwork: null, claudeAuthVolume: null, runnerImage: 'claudecloud-runner:local' };
// Coolify: the panel sits on `coolify`, the resource network and the stack's labelled `sessions` network.
const onThree = {
  ...selfInspect,
  NetworkSettings: { Networks: { coolify: {}, x0k8s4c0gwsk0ow4cgcg8wkw: {}, x0k8s4c0gwsk0ow4cgcg8wkw_sessions: {} } },
};
const sessionsLabelled = new Set(['x0k8s4c0gwsk0ow4cgcg8wkw_sessions']);

describe('pickStackInfo', () => {
  it('picks the network labelled as the compose project sessions network, and the /claude-auth volume', () => {
    expect(pickStackInfo(onThree, noEnv, sessionsLabelled)).toEqual({
      networkName: 'x0k8s4c0gwsk0ow4cgcg8wkw_sessions',
      claudeAuthVolume: 'x0k8s4c0gwsk0ow4cgcg8wkw_claude-auth',
      runnerImage: 'claudecloud-runner:local',
    });
  });

  it('never falls back to a network merely shared with postgres or the proxy', () => {
    // The resource network (which holds postgres and docker-proxy under Coolify) is not labelled `sessions`.
    expect(() => pickStackInfo(selfInspect, noEnv, new Set())).toThrow(/sessions.*STACK_NETWORK/);
    expect(() => pickStackInfo(selfInspect, noEnv, null)).toThrow(/STACK_NETWORK/);
  });

  it('only accepts a labelled network the panel is actually attached to', () => {
    expect(() => pickStackInfo(selfInspect, noEnv, new Set(['someone-else_sessions']))).toThrow(StackDiscoveryError);
  });

  it('is actionable when two attached networks carry the label', () => {
    const two = { ...selfInspect, NetworkSettings: { Networks: { a: {}, b: {} } } };
    expect(() => pickStackInfo(two, noEnv, new Set(['a', 'b']))).toThrow(/ambiguous.*STACK_NETWORK/);
  });

  it('lets env overrides win', () => {
    const info = pickStackInfo(selfInspect, { ...noEnv, stackNetwork: 'dev_net', claudeAuthVolume: 'dev_auth' });
    expect(info.networkName).toBe('dev_net');
    expect(info.claudeAuthVolume).toBe('dev_auth');
  });

  it('works with no self inspect when env supplies both values', () => {
    expect(pickStackInfo(null, { ...noEnv, stackNetwork: 'n', claudeAuthVolume: 'v' })).toMatchObject({
      networkName: 'n',
      claudeAuthVolume: 'v',
    });
  });

  it('throws naming /claude-auth when the mount is missing', () => {
    const inspect = { ...onThree, Mounts: selfInspect.Mounts.slice(0, 1) };
    expect(() => pickStackInfo(inspect, noEnv, sessionsLabelled)).toThrow(StackDiscoveryError);
    expect(() => pickStackInfo(inspect, noEnv, sessionsLabelled)).toThrow('/claude-auth');
  });
});

describe('unsafeNetworkPeers', () => {
  const panel = { Names: ['/panel-1'], Labels: { 'com.docker.compose.service': 'panel' }, Mounts: [] };
  const session = { Names: ['/claudecloud-session-ab12'], Labels: { 'claudecloud.session': 'x' } };

  it('allows the panel and other sessions', () => {
    expect(unsafeNetworkPeers([panel, session])).toEqual([]);
  });

  it('flags the socket proxy and postgres services', () => {
    expect(
      unsafeNetworkPeers([
        panel,
        { Names: ['/docker-proxy-x'], Labels: { 'com.docker.compose.service': 'docker-proxy' } },
        { Names: ['/postgres-x'], Labels: { 'com.docker.compose.service': 'postgres' } },
      ]),
    ).toEqual(['docker-proxy', 'postgres']);
  });

  it('flags any container that mounts the Docker socket, whatever it is called', () => {
    expect(
      unsafeNetworkPeers([
        { Names: ['/watchtower'], Labels: {}, Mounts: [{ Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' }] },
        { Names: ['/other'], Mounts: [{ Source: '/run/user/1000/docker.sock', Destination: '/sock/docker.sock' }] },
      ]),
    ).toEqual(['watchtower (mounts docker.sock)', 'other (mounts docker.sock)']);
  });
});
