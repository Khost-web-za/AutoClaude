import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '@/github/app-manifest';
import { createGithubDeps } from '@/github/github-deps';
import { issueState, verifyState } from '@/github/oauth-state';
import type { Db } from '@/db/client';
import type { SecretStore } from '@/secret-store/secret-store';

describe('buildManifest', () => {
  const manifest = buildManifest('https://claude.example.com', 'octocat') as Record<string, unknown>;

  it('uses the exact urls and keeps webhooks off', () => {
    expect(manifest).toMatchObject({
      name: 'ClaudeCloud (claude.example.com)',
      url: 'https://claude.example.com',
      redirect_url: 'https://claude.example.com/api/github/manifest/callback',
      setup_url: 'https://claude.example.com/api/github/setup',
      callback_urls: ['https://claude.example.com/api/github/oauth/callback'],
      request_oauth_on_install: false,
      public: false,
      hook_attributes: { active: false },
      default_permissions: {
        contents: 'write',
        pull_requests: 'write',
        metadata: 'read',
        workflows: 'write',
      },
    });
  });

  it('tolerates a trailing slash and keeps the app name within GitHub limits', () => {
    const long = buildManifest('https://a-very-long-subdomain.claude-cloud-panel.example.com/', 'x') as {
      name: string;
      url: string;
      redirect_url: string;
    };
    expect(long.name.length).toBeLessThanOrEqual(34);
    expect(long.url).toBe('https://a-very-long-subdomain.claude-cloud-panel.example.com');
    expect(long.redirect_url).not.toContain('com//');
  });
});

describe('state nonce', () => {
  const key = randomBytes(32);
  const make = (now = () => 1_000_000) =>
    createGithubDeps({
      db: {} as Db,
      secretStore: {} as SecretStore,
      apiUrl: 'http://127.0.0.1:1',
      publicUrl: 'https://claude.example.com',
      stateKey: key,
      now,
    });

  it('accepts the matching state and cookie exactly once', () => {
    const deps = make();
    const { state, cookie } = issueState('manifest', deps);
    expect(verifyState('manifest', state, cookie.value, deps)).toBe(true);
    expect(verifyState('manifest', state, cookie.value, deps)).toBe(false);
  });

  it('issues unguessable, distinct nonces in an HttpOnly, path-scoped cookie', () => {
    const deps = make();
    const a = issueState('manifest', deps);
    const b = issueState('manifest', deps);
    expect(a.state).not.toBe(b.state);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(a.cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/github' });
  });

  it('rejects a wrong state, a tampered cookie, a missing cookie and another purpose', () => {
    const deps = make();
    const { state, cookie } = issueState('manifest', deps);
    expect(verifyState('manifest', 'nope', cookie.value, deps)).toBe(false);
    expect(verifyState('manifest', state, cookie.value.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), deps)).toBe(false);
    expect(verifyState('manifest', state, undefined, deps)).toBe(false);
    expect(verifyState('oauth', state, cookie.value, deps)).toBe(false);
    expect(verifyState('manifest', state, cookie.value, deps)).toBe(true);
  });

  it('rejects an expired cookie and a cookie signed with another key', () => {
    let now = 1_000_000;
    const deps = make(() => now);
    const { state, cookie } = issueState('oauth', deps);
    now += 11 * 60 * 1000;
    expect(verifyState('oauth', state, cookie.value, deps)).toBe(false);

    const other = createGithubDeps({ ...deps, stateKey: randomBytes(32) });
    const foreign = issueState('oauth', other);
    expect(verifyState('oauth', foreign.state, foreign.cookie.value, deps)).toBe(false);
  });
});
