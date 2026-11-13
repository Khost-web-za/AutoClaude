import { describe, expect, it } from 'vitest';
import { GITHUB_APP_PERMISSIONS } from '@/github/app-manifest';
import { NoInstallationError, mintGitCredential, githubIdentityMode } from '@/github/tokens';
import { resolveCommitIdentity } from '@/github/user-auth';
import { seedApp, seedInstallation, tokenReply, withGithub, type GithubCtx } from './github-fixtures';
import { verifyAppJwt } from './github-stub';

const MIN = 60_000;

function stubInstallationTokens(ctx: GithubCtx, installationId: number, prefix = 'ghs_inst') {
  let n = 0;
  ctx.stub.on(`POST /app/installations/${installationId}/access_tokens`, async (req) => {
    await verifyAppJwt(ctx.keys, req.headers.authorization);
    n += 1;
    return tokenReply(`${prefix}_${n}`, 60 * MIN, ctx.clock);
  });
}

async function putUserToken(
  ctx: GithubCtx,
  token: { accessToken: string; refreshToken: string | null; expiresInMs: number | null },
) {
  await ctx.secrets.put(
    'github_user_token',
    'default',
    JSON.stringify({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresInMs === null ? null : ctx.clock.now + token.expiresInMs,
      refreshExpiresAt: null,
      login: 'octocat',
    }),
  );
}

describe('mintGitCredential: installation tokens', () => {
  it('mints a token scoped to the single repo with the minimal permissions', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      stubInstallationTokens(ctx, 11);

      const credential = await mintGitCredential('acme/widgets', ctx.deps);
      expect(credential).toEqual({
        username: 'x-access-token',
        password: 'ghs_inst_1',
        expiresAt: new Date(ctx.clock.now + 60 * MIN).toISOString(),
      });
      const request = ctx.stub.requests.find((r) => r.path.endsWith('/access_tokens'));
      expect(request?.body).toEqual({ repositories: ['widgets'], permissions: GITHUB_APP_PERMISSIONS });
    });
  });

  it('caches per repo until 5 minutes before expiry, then mints again', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      stubInstallationTokens(ctx, 11);

      const first = await mintGitCredential('acme/widgets', ctx.deps);
      const second = await mintGitCredential('acme/widgets', ctx.deps);
      expect(second.password).toBe(first.password);
      expect(ctx.stub.count('POST /app/installations/11/access_tokens')).toBe(1);

      const other = await mintGitCredential('acme/gadgets', ctx.deps);
      expect(other.password).not.toBe(first.password);
      expect(ctx.stub.count('POST /app/installations/11/access_tokens')).toBe(2);

      ctx.clock.now += 54 * MIN;
      expect((await mintGitCredential('acme/widgets', ctx.deps)).password).toBe(first.password);
      ctx.clock.now += 2 * MIN;
      expect((await mintGitCredential('acme/widgets', ctx.deps)).password).not.toBe(first.password);
    });
  });

  it('shares one request between concurrent mints', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      stubInstallationTokens(ctx, 11);
      const results = await Promise.all(Array.from({ length: 5 }, () => mintGitCredential('acme/widgets', ctx.deps)));
      expect(new Set(results.map((r) => r.password)).size).toBe(1);
      expect(ctx.stub.count('POST /app/installations/11/access_tokens')).toBe(1);
    });
  });

  it('picks the installation whose account matches the owner, case-insensitively', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'Acme');
      await seedInstallation(ctx, 12, 'other');
      stubInstallationTokens(ctx, 11, 'ghs_acme');
      stubInstallationTokens(ctx, 12, 'ghs_other');
      expect((await mintGitCredential('ACME/widgets', ctx.deps)).password).toBe('ghs_acme_1');
      expect((await mintGitCredential('other/x', ctx.deps)).password).toBe('ghs_other_1');
    });
  });

  it('throws NoInstallationError for an unknown owner without calling GitHub', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      await expect(mintGitCredential('stranger/repo', ctx.deps)).rejects.toMatchObject({
        name: 'NoInstallationError',
        owner: 'stranger',
      });
      await expect(mintGitCredential('stranger/repo', ctx.deps)).rejects.toBeInstanceOf(NoInstallationError);
      expect(ctx.stub.requests).toHaveLength(0);
    });
  });

  it('rejects malformed repo names and never leaks a key or token in errors', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      await expect(mintGitCredential('acme/../etc', ctx.deps)).rejects.toThrow();
      await expect(mintGitCredential('no-slash', ctx.deps)).rejects.toThrow();

      ctx.stub.on('POST /app/installations/11/access_tokens', { status: 422, json: { message: 'nope' } });
      const error = await mintGitCredential('acme/widgets', ctx.deps).catch((e: unknown) => e as Error);
      expect(String((error as Error).message) + String((error as Error).stack)).not.toMatch(/BEGIN|Bearer|eyJ/);
    });
  });
});

describe('mintGitCredential: user token', () => {
  it('prefers a valid user token and makes no GitHub call', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      await putUserToken(ctx, { accessToken: 'ghu_valid', refreshToken: 'ghr_1', expiresInMs: 60 * MIN });
      const credential = await mintGitCredential('acme/widgets', ctx.deps);
      expect(credential).toMatchObject({ username: 'x-access-token', password: 'ghu_valid' });
      expect(ctx.stub.requests).toHaveLength(0);
    });
  });

  it('refreshes a token with under 5 minutes left and stores the rotated pair', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      await putUserToken(ctx, { accessToken: 'ghu_old', refreshToken: 'ghr_old', expiresInMs: 2 * MIN });
      ctx.stub.on('POST /login/oauth/access_token', {
        json: { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28_800, refresh_token_expires_in: 15_811_200 },
      });

      const results = await Promise.all([
        mintGitCredential('acme/widgets', ctx.deps),
        mintGitCredential('acme/widgets', ctx.deps),
      ]);
      expect(results.map((r) => r.password)).toEqual(['ghu_new', 'ghu_new']);
      expect(ctx.stub.count('POST /login/oauth/access_token')).toBe(1);
      expect(ctx.stub.requests[0]?.body).toEqual({
        client_id: 'Iv1.client',
        client_secret: 'client-secret-value',
        grant_type: 'refresh_token',
        refresh_token: 'ghr_old',
      });
      const saved = JSON.parse((await ctx.secrets.get('github_user_token', 'default')) ?? '{}') as Record<string, unknown>;
      expect(saved).toMatchObject({ accessToken: 'ghu_new', refreshToken: 'ghr_new', expiresAt: ctx.clock.now + 28_800_000 });
    });
  });

  it('falls back to the installation token when the refresh fails (HTTP error or error body)', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      stubInstallationTokens(ctx, 11);
      await putUserToken(ctx, { accessToken: 'ghu_old', refreshToken: 'ghr_old', expiresInMs: 2 * MIN });

      ctx.stub.on('POST /login/oauth/access_token', { status: 200, json: { error: 'bad_refresh_token' } });
      expect((await mintGitCredential('acme/widgets', ctx.deps)).password).toBe('ghs_inst_1');

      ctx.stub.on('POST /login/oauth/access_token', { status: 500, json: {} });
      expect((await mintGitCredential('acme/other', ctx.deps)).password).toBe('ghs_inst_2');
    });
  });

  it('falls back when an expired token has no refresh token', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 11, 'acme');
      stubInstallationTokens(ctx, 11);
      await putUserToken(ctx, { accessToken: 'ghu_dead', refreshToken: null, expiresInMs: -MIN });
      expect((await mintGitCredential('acme/widgets', ctx.deps)).password).toBe('ghs_inst_1');
    });
  });
});

describe('identity', () => {
  it('githubIdentityMode is user only with a usable user token', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      expect(await githubIdentityMode(ctx.deps)).toBe('app');
      await putUserToken(ctx, { accessToken: 'ghu_dead', refreshToken: null, expiresInMs: -MIN });
      expect(await githubIdentityMode(ctx.deps)).toBe('app');
      await putUserToken(ctx, { accessToken: 'ghu_ok', refreshToken: 'r', expiresInMs: 60 * MIN });
      expect(await githubIdentityMode(ctx.deps)).toBe('user');
    });
  });

  it('commit identity comes from GET /user with the user token (name, else login)', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await putUserToken(ctx, { accessToken: 'ghu_ok', refreshToken: 'r', expiresInMs: 60 * MIN });
      ctx.stub.on('GET /user', { json: { id: 321, login: 'octocat', name: 'Octo Cat' } });
      expect(await resolveCommitIdentity(ctx.deps)).toEqual({
        name: 'Octo Cat',
        email: '321+octocat@users.noreply.github.com',
      });
      expect(ctx.stub.requests[0]?.headers.authorization).toBe('Bearer ghu_ok');

      ctx.stub.on('GET /user', { json: { id: 321, login: 'octocat', name: null } });
      expect((await resolveCommitIdentity(ctx.deps)).name).toBe('octocat');
    });
  });

  it('without a user token the identity is the app bot', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      ctx.stub.on('GET /users/claudecloud-test%5Bbot%5D', { json: { id: 9001, login: 'claudecloud-test[bot]' } });
      ctx.stub.on('GET /users/claudecloud-test[bot]', { json: { id: 9001, login: 'claudecloud-test[bot]' } });
      expect(await resolveCommitIdentity(ctx.deps)).toEqual({
        name: 'claudecloud-test[bot]',
        email: '9001+claudecloud-test[bot]@users.noreply.github.com',
      });
    });
  });
});
