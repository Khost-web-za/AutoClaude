import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const URL_LINE =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=stub&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge=c&state=s';
const CREDS = '{"claudeAiOauth":{"accessToken":"stub-a","refreshToken":"stub-r","expiresAt":4102444800000,"subscriptionType":"max","scopes":["user:inference"]}}';

// Scripted stand-in for `claude auth login`: prints the URL, reads one line, writes credentials only for the right code.
const STUB = [
  `printf '%s\\r\\n%s\\r\\n%s' 'Opening browser to sign in...' 'If the browser did not open, visit: ${URL_LINE}' 'Paste code here if prompted > '`,
  'read code',
  'mkdir -p "$HOME/.claude"',
  `[ "$code" = "good-code" ] && printf '%s' '${CREDS}' > "$HOME/.claude/.credentials.json"`,
  'sleep 300',
].join('; ');

// Any small image with sh works; the panel's own postgres test image is already pulled locally.
const IMAGE = process.env.PANEL_LOGIN_IT_IMAGE ?? 'postgres:17-alpine';

describe.skipIf(process.env.PANEL_DOCKER_IT !== '1')('login helper plumbing (scripted fake claude)', () => {
  let dir: string;
  const backups = new Map<string, string>();

  beforeAll(async () => {
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
    vi.stubEnv('STACK_NETWORK', 'unused');
    vi.stubEnv('CLAUDE_AUTH_VOLUME', 'unused');
    dir = await mkdtemp(path.join(tmpdir(), 'claude-login-it-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    const { createCredentialsVolume } = await import('@/claude/credentials-volume');
    const volume = createCredentialsVolume({
      dir,
      store: {
        put: async (kind, ref, value) => void backups.set(`${kind}:${ref}`, value),
        get: async (kind, ref) => backups.get(`${kind}:${ref}`) ?? null,
      },
    });
    const login = await import('@/claude/login-helper');
    const options = {
      image: IMAGE,
      command: { entrypoint: ['sh'], cmd: ['-c', STUB] },
      volume,
      timeouts: { url: 30_000, success: 15_000 },
    };
    return { login, options };
  }

  it('surfaces the URL, rejects a wrong code, then accepts the right one and copies the credentials', async () => {
    const { login, options } = await setup();
    const { loginId, url } = await login.startLogin(options);
    expect(url).toBe(URL_LINE);

    const bad = await login.submitLoginCode(loginId, 'wrong');
    expect(bad).toMatchObject({ ok: false });
    expect(JSON.stringify(bad)).not.toContain('stub-');

    // The helper read its single line for the wrong code, so the retry path needs a fresh login.
    await login.cancelLogin(loginId);
    const second = await login.startLogin(options);
    const good = await login.submitLoginCode(second.loginId, 'good-code');
    expect(good).toEqual({ ok: true });
    expect(await readFile(path.join(dir, '.credentials.json'), 'utf8')).toBe(CREDS);
    expect(backups.get('claude_credentials_backup:default')).toBe(CREDS);
  });

  it('boot sweep removes labelled helpers left behind', async () => {
    const { login, options } = await setup();
    const { loginId } = await login.startLogin(options);
    const { docker } = await import('@/docker/docker-client');
    const labelled = () =>
      docker.listContainers({ all: true, filters: { label: [`claudecloud.login-id=${loginId}`] } });
    expect(await labelled()).toHaveLength(1);
    expect(await login.removeStaleLoginHelpers()).toBeGreaterThanOrEqual(1);
    expect(await labelled()).toHaveLength(0);
    await login.cancelLogin(loginId);
  });

  it('cancel removes the helper container', async () => {
    const { login, options } = await setup();
    const { loginId } = await login.startLogin(options);
    const { docker } = await import('@/docker/docker-client');
    const labelled = () => docker.listContainers({ all: true, filters: { label: [`claudecloud.login-id=${loginId}`] } });
    expect(await labelled()).toHaveLength(1);
    await login.cancelLogin(loginId);
    expect(await labelled()).toHaveLength(0);
  });
});
