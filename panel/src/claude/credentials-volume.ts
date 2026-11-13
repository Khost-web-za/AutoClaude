import { randomBytes } from 'node:crypto';
import { chmod, chown, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { secretStore, type SecretStore } from '@/secret-store/secret-store';

const CREDENTIALS_FILE = '.credentials.json';
const BACKUP_REF = 'default';
const SESSION_UID = 1000;
const SESSION_GID = 1000;
const WATCH_INTERVAL_MS = 60_000;

export type ClaudeCredentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    subscriptionType: string | null;
    scopes: string[];
  };
};

/** Parses the credentials file; null unless it carries a usable `claudeAiOauth`. */
export function parseCredentials(text: string): ClaudeCredentials | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const oauth = (raw as { claudeAiOauth?: Record<string, unknown> } | null)?.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return null;
  const { accessToken, refreshToken, expiresAt, subscriptionType, scopes } = oauth;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof refreshToken !== 'string' || !refreshToken) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  return {
    claudeAiOauth: {
      accessToken,
      refreshToken,
      expiresAt,
      subscriptionType: typeof subscriptionType === 'string' ? subscriptionType : null,
      scopes: Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : [],
    },
  };
}

export type CredentialsVolumeDeps = {
  /** Where the shared `/claude-auth` volume is mounted in the panel. */
  dir: string;
  store: Pick<SecretStore, 'put' | 'get'>;
};

export function createCredentialsVolume({ dir, store }: CredentialsVolumeDeps) {
  const file = path.join(dir, CREDENTIALS_FILE);

  async function readRaw(): Promise<string | null> {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  async function credentialsMtime(): Promise<Date | null> {
    try {
      return (await stat(file)).mtime;
    } catch {
      return null;
    }
  }

  /** Write temp + rename so session containers never see a partial file. */
  async function writeCredentialsAtomic(content: string): Promise<void> {
    const temp = path.join(dir, `${CREDENTIALS_FILE}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(temp, content, { mode: 0o600 });
      await chmod(temp, 0o600);
      try {
        await chown(temp, SESSION_UID, SESSION_GID);
      } catch (error) {
        // The panel image runs as uid 1000 (= the runner's `claude`), so this is a no-op there. Anywhere
        // else the file stays 0600 under the panel's uid and session containers may not read it: say so.
        const code = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.name : 'error');
        console.warn(`[claude] could not chown the credentials file to ${SESSION_UID}:${SESSION_GID} (${code})`);
      }
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  /** Encrypts the live file into the secret store; false when there is nothing valid to back up. */
  async function backupCredentials(): Promise<boolean> {
    const text = await readRaw();
    if (text === null || !parseCredentials(text)) return false;
    await store.put('claude_credentials_backup', BACKUP_REF, text);
    return true;
  }

  return {
    credentialsPath: file,
    writeCredentialsAtomic,
    credentialsMtime,
    backupCredentials,

    async readCredentials(): Promise<ClaudeCredentials | null> {
      const text = await readRaw();
      return text === null ? null : parseCredentials(text);
    },

    /** Boot-time: when the live file is gone, put the backup back. Returns whether it restored. */
    async restoreCredentialsIfMissing(): Promise<boolean> {
      if (await credentialsMtime()) return false;
      const backup = await store.get('claude_credentials_backup', BACKUP_REF);
      if (backup === null || !parseCredentials(backup)) return false;
      await writeCredentialsAtomic(backup);
      return true;
    },

    /** Backs up whenever the file's mtime changes (the runners refresh tokens in place). */
    startCredentialsWatcher(intervalMs = WATCH_INTERVAL_MS): () => void {
      let last: number | null = null;
      let running = false;
      const tick = async () => {
        if (running) return;
        running = true;
        try {
          const mtime = (await credentialsMtime())?.getTime() ?? null;
          // The first tick backs up too: the file may have changed while the panel was down.
          if (mtime !== null && mtime !== last) await backupCredentials();
          last = mtime;
        } catch (error) {
          console.warn('[claude] credentials backup failed:', error instanceof Error ? error.name : 'error');
        } finally {
          running = false;
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

export type CredentialsVolume = ReturnType<typeof createCredentialsVolume>;

let shared: CredentialsVolume | undefined;
/** The panel's volume at `/claude-auth` (CLAUDE_AUTH_DIR overrides it for local dev). */
export const credentialsVolume = (): CredentialsVolume =>
  (shared ??= createCredentialsVolume({ dir: process.env.CLAUDE_AUTH_DIR ?? '/claude-auth', store: secretStore }));

export const readCredentials = () => credentialsVolume().readCredentials();
export const backupCredentials = () => credentialsVolume().backupCredentials();
export const restoreCredentialsIfMissing = () => credentialsVolume().restoreCredentialsIfMissing();
export const startCredentialsWatcher = (intervalMs?: number) =>
  credentialsVolume().startCredentialsWatcher(intervalMs);
