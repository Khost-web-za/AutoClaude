import { randomBytes } from 'node:crypto';
import { githubInstallations } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { saveApp } from '@/github/app-store';
import { createGithubDeps, type GithubDeps } from '@/github/github-deps';
import { createSecretStore } from '@/secret-store/secret-store';
import { makeAppKeys, startGithubStub, type AppKeys, type GithubStub } from './github-stub';

export const PUBLIC_URL = 'https://claude.example.com';

export type GithubCtx = {
  deps: GithubDeps;
  stub: GithubStub;
  keys: AppKeys;
  clock: { now: number };
  secrets: ReturnType<typeof createSecretStore>;
};

/** Throwaway database + local GitHub stub + real RSA key; the clock is controllable. */
export async function withGithub<T>(fn: (ctx: GithubCtx) => Promise<T>): Promise<T> {
  const stub = await startGithubStub();
  try {
    return await withTestDb(async ({ db }) => {
      const key = randomBytes(32);
      const secrets = createSecretStore({ db, key });
      const clock = { now: Date.parse('2030-01-01T00:00:00Z') };
      const keys = makeAppKeys();
      const deps = createGithubDeps({
        db,
        secretStore: secrets,
        apiUrl: stub.url,
        publicUrl: PUBLIC_URL,
        stateKey: key,
        now: () => clock.now,
      });
      return await fn({ deps, stub, keys, clock, secrets });
    });
  } finally {
    await stub.close();
  }
}

export async function seedApp(ctx: GithubCtx, overrides: { appId?: number; slug?: string } = {}) {
  await saveApp(
    {
      appId: overrides.appId ?? 4242,
      slug: overrides.slug ?? 'claudecloud-test',
      clientId: 'Iv1.client',
      clientSecret: 'client-secret-value',
      privateKey: ctx.keys.privatePem,
      webhookSecret: 'webhook-secret-value',
      ownerLogin: 'octocat',
      htmlUrl: 'https://github.com/apps/claudecloud-test',
    },
    ctx.deps,
  );
}

export async function seedInstallation(ctx: GithubCtx, installationId: number, accountLogin: string) {
  await ctx.deps.db
    .insert(githubInstallations)
    .values({ installationId, accountLogin, accountType: 'User' })
    .onConflictDoNothing();
}

export const tokenReply = (token: string, expiresInMs: number, clock: { now: number }) => ({
  status: 201,
  json: { token, expires_at: new Date(clock.now + expiresInMs).toISOString() },
});
