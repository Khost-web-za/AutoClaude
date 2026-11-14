import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildContainerSpec,
  supportsStorageOpt,
  type ContainerSpecInput,
} from '@/sessions/container-spec';

const ID = 'a1f3c0de-1111-4222-8333-444455556666';

const input = (overrides: Partial<ContainerSpecInput> = {}): ContainerSpecInput => ({
  sessionId: ID,
  secret: 'session-secret',
  repoFullName: 'acme/widgets',
  baseBranch: 'develop',
  defaultBranch: 'main',
  workBranch: 'claude/fix-a1f3',
  startingTask: 'Fix it',
  gitAuthor: { name: 'Octo Cat', email: '1+octo@users.noreply.github.com' },
  runnerImage: 'claudecloud-runner:local',
  networkName: 'stack_default',
  claudeAuthVolume: 'stack_claude-auth',
  runtime: 'sysbox-runc',
  repoUrlTemplate: null,
  cpus: 4,
  memoryGb: 8,
  diskGb: 40,
  storageOptSupported: false,
  deliveryMode: 'pull_request',
  ...overrides,
});

const envOf = (spec: ReturnType<typeof buildContainerSpec>) =>
  Object.fromEntries((spec.Env ?? []).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

/** Variable names from the env table in docs/runner-contract.md. */
function contractVars(): string[] {
  const doc = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'docs', 'runner-contract.md'), 'utf8');
  return [...doc.matchAll(/^\| `([A-Z0-9_]+)`(?: \/ `([A-Z0-9_]+)`)? \|/gm)].flatMap((m) => [m[1]!, ...(m[2] ? [m[2]] : [])]);
}

describe('buildContainerSpec', () => {
  it('env keys equal the runner contract (minus the test-only CLAUDE_BIN) when every option is on', () => {
    const spec = buildContainerSpec(input({ repoUrlTemplate: 'file:///repos/{owner}/{name}.git' }));
    const expected = contractVars().filter((name) => name !== 'CLAUDE_BIN');
    expect(expected).toContain('SESSION_SECRET');
    expect(Object.keys(envOf(spec)).sort()).toEqual([...expected].sort());
    expect(spec.Env).toHaveLength(expected.length);
  });

  it('sets the contract values', () => {
    const env = envOf(buildContainerSpec(input({ repoUrlTemplate: 'file:///repos/{owner}/{name}.git' })));
    expect(env).toMatchObject({
      SESSION_ID: ID,
      SESSION_SECRET: 'session-secret',
      PANEL_URL: 'http://panel:3100',
      REPO_FULL_NAME: 'acme/widgets',
      REPO_URL: 'file:///repos/acme/widgets.git',
      BASE_BRANCH: 'develop',
      DEFAULT_BRANCH: 'main',
      WORK_BRANCH: 'claude/fix-a1f3',
      GIT_AUTHOR_NAME: 'Octo Cat',
      GIT_AUTHOR_EMAIL: '1+octo@users.noreply.github.com',
      SESSION_DOCKER: 'true',
      DELIVERY_MODE: 'pull_request',
    });
  });

  it('omits REPO_URL without a template, SESSION_DOCKER with runc, STARTING_TASK_B64 without a task', () => {
    const env = envOf(buildContainerSpec(input({ runtime: 'runc', startingTask: null })));
    expect(env).not.toHaveProperty('REPO_URL');
    expect(env).not.toHaveProperty('SESSION_DOCKER');
    expect(env).not.toHaveProperty('STARTING_TASK_B64');
  });

  it('passes the delivery mode', () => {
    expect(envOf(buildContainerSpec(input())).DELIVERY_MODE).toBe('pull_request');
    expect(envOf(buildContainerSpec(input({ deliveryMode: 'push', workBranch: 'develop' }))).DELIVERY_MODE).toBe('push');
  });

  it('starting task base64 round-trips emoji, quotes and newlines', () => {
    const task = 'Line 1 🚀\nline "2" $HOME `id`\r\n\tend ✓';
    const env = envOf(buildContainerSpec(input({ startingTask: task })));
    expect(Buffer.from(env.STARTING_TASK_B64!, 'base64').toString('utf8')).toBe(task);
  });

  it('is never privileged, has no binds and mounts exactly the two volumes', () => {
    const spec = buildContainerSpec(input());
    expect(spec.HostConfig).not.toHaveProperty('Privileged');
    expect(spec.HostConfig).not.toHaveProperty('Binds');
    expect(spec.HostConfig?.Mounts).toEqual([
      { Type: 'volume', Source: 'stack_claude-auth', Target: '/claude-auth' },
      { Type: 'volume', Source: 'claudecloud-session-a1f3-docker', Target: '/var/lib/docker' },
    ]);
  });

  it('names, labels, limits and attaches the container', () => {
    const spec = buildContainerSpec(input({ cpus: 1.5, memoryGb: 2 }));
    expect(spec.name).toBe('claudecloud-session-a1f3');
    expect(spec.Image).toBe('claudecloud-runner:local');
    expect(spec.Labels).toEqual({ 'claudecloud.session': ID, 'claudecloud.role': 'session' });
    expect(spec.HostConfig).toMatchObject({
      Runtime: 'sysbox-runc',
      NanoCpus: 1_500_000_000,
      Memory: 2 * 1024 ** 3,
      NetworkMode: 'stack_default',
      RestartPolicy: { Name: 'unless-stopped' },
    });
  });

  it('sets StorageOpt.size only when the storage driver supports it', () => {
    expect(buildContainerSpec(input()).HostConfig).not.toHaveProperty('StorageOpt');
    expect(buildContainerSpec(input({ storageOptSupported: true })).HostConfig?.StorageOpt).toEqual({ size: '40G' });
  });
});

describe('supportsStorageOpt', () => {
  it('accepts btrfs, zfs and overlay2 on xfs; rejects the rest', () => {
    expect(supportsStorageOpt({ Driver: 'btrfs' })).toBe(true);
    expect(supportsStorageOpt({ Driver: 'zfs' })).toBe(true);
    expect(supportsStorageOpt({ Driver: 'overlay2', DriverStatus: [['Backing Filesystem', 'xfs']] })).toBe(true);
    expect(supportsStorageOpt({ Driver: 'overlay2', DriverStatus: [['Backing Filesystem', 'extfs']] })).toBe(false);
    expect(supportsStorageOpt({ Driver: 'overlayfs', DriverStatus: [['driver-type', 'io.containerd.snapshotter.v1']] })).toBe(false);
    expect(supportsStorageOpt({})).toBe(false);
  });
});
