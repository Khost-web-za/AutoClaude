import { beforeAll, describe, expect, it, vi } from 'vitest';

describe.skipIf(process.env.PANEL_DOCKER_IT !== '1')('local docker', () => {
  beforeAll(() => {
    // Local engine: named pipe on Windows, the default socket elsewhere.
    vi.stubEnv(
      'DOCKER_HOST',
      process.env.DOCKER_HOST ??
        (process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock'),
    );
    vi.stubEnv('PANEL_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
    vi.stubEnv('ALLOWED_EMAIL', 'owner@example.com');
    vi.stubEnv('CF_ACCESS_TEAM_DOMAIN', 'example.cloudflareaccess.com');
    vi.stubEnv('CF_ACCESS_AUD', 'aud');
    vi.stubEnv('PANEL_PUBLIC_URL', 'http://localhost:3000');
    vi.stubEnv('DATABASE_URL', process.env.DATABASE_URL ?? 'postgres://x');
  });

  it('reaches the engine', async () => {
    const { docker } = await import('@/docker/docker-client');
    const info = await docker.info();
    expect(typeof info.ServerVersion).toBe('string');
  });

  it('hasSysbox returns a boolean', async () => {
    const { hasSysbox } = await import('@/docker/sysbox-check');
    expect(typeof (await hasSysbox())).toBe('boolean');
  });
});
