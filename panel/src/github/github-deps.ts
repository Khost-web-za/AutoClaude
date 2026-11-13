import { db as sharedDb, type Db } from '@/db/client';
import { getPanelEnv } from '@/env/panel-env';
import { secretStore as sharedSecretStore, type SecretStore } from '@/secret-store/secret-store';
import { TtlCache } from './ttl-cache';

export type InstallationTokenValue = { token: string; expiresAt: number };

/** Everything the GitHub modules need, injectable so tests bind a stub server, a test DB and a fake clock. */
export type GithubDeps = {
  db: Db;
  secretStore: SecretStore;
  /** githubApiUrl: every GitHub request goes through it. */
  apiUrl: string;
  publicUrl: string;
  /** Signs the single-use state cookies (a subkey is derived from it). */
  stateKey: Buffer;
  now: () => number;
  /** Installation tokens by `installationId|repo`, held until 5 minutes before they expire. Memory only. */
  tokenCache: TtlCache<InstallationTokenValue>;
  /** Repo and branch listings, 60 s. */
  listCache: TtlCache<unknown>;
  /** Bot commit identities, by app slug. */
  identityCache: TtlCache<{ name: string; email: string }>;
  /** Nonces already spent, with their expiry. */
  spentStates: Map<string, number>;
  /** The one in-flight user-token refresh, so rotating refresh tokens are never used twice. */
  refreshing: { current: Promise<unknown> | null };
};

export type GithubDepsInput = Pick<GithubDeps, 'db' | 'secretStore' | 'apiUrl' | 'publicUrl' | 'stateKey'> &
  Partial<GithubDeps>;

export function createGithubDeps(input: GithubDepsInput): GithubDeps {
  const now = input.now ?? Date.now;
  return {
    ...input,
    now,
    tokenCache: input.tokenCache ?? new TtlCache(now),
    listCache: input.listCache ?? new TtlCache(now),
    identityCache: input.identityCache ?? new TtlCache(now),
    spentStates: input.spentStates ?? new Map(),
    refreshing: input.refreshing ?? { current: null },
  };
}

const globalForGithub = globalThis as typeof globalThis & { __githubDeps?: GithubDeps };

/** The app's deps. Held on globalThis so caches survive module re-evaluation between instrumentation and routes. */
export function sharedGithubDeps(): GithubDeps {
  if (!globalForGithub.__githubDeps) {
    const env = getPanelEnv();
    globalForGithub.__githubDeps = createGithubDeps({
      db: sharedDb,
      secretStore: sharedSecretStore,
      apiUrl: env.githubApiUrl,
      publicUrl: env.publicUrl.replace(/\/+$/, ''),
      stateKey: env.encryptionKey,
    });
  }
  return globalForGithub.__githubDeps;
}
