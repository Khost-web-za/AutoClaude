import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeStatus, maskEmail } from '@/claude/claude-account';
import { createCredentialsVolume, parseCredentials } from '@/claude/credentials-volume';

const creds = (expiresAt: number) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat-ACCESS-SECRET',
      refreshToken: 'sk-ant-ort-REFRESH-SECRET',
      expiresAt,
      subscriptionType: 'max',
      scopes: ['user:inference', 'user:profile'],
    },
  });

function fakeStore() {
  const map = new Map<string, string>();
  return {
    map,
    async put(kind: string, ref: string, value: string) {
      map.set(`${kind}:${ref}`, value);
    },
    async get(kind: string, ref: string) {
      return map.get(`${kind}:${ref}`) ?? null;
    },
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'claude-auth-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('maskEmail', () => {
  it('masks the local part', () => {
    expect(maskEmail('owner@example.com')).toBe('o••••@example.com');
  });
  it('handles odd input', () => {
    expect(maskEmail('a@b.co')).toBe('a••••@b.co');
    expect(maskEmail('nonsense')).toBe('••••');
    expect(maskEmail('@x.com')).toBe('••••');
  });
});

describe('parseCredentials', () => {
  it('requires a usable claudeAiOauth', () => {
    expect(parseCredentials(creds(1))).not.toBeNull();
    expect(parseCredentials('not json')).toBeNull();
    expect(parseCredentials('{}')).toBeNull();
    expect(parseCredentials('{"claudeAiOauth":{"accessToken":"a"}}')).toBeNull();
  });
});

describe('backup and restore', () => {
  it('restores identical bytes when the file is missing', async () => {
    const store = fakeStore();
    const volume = createCredentialsVolume({ dir, store });
    const original = creds(Date.now() + 1000);
    await writeFile(volume.credentialsPath, original);
    expect(await volume.backupCredentials()).toBe(true);
    expect([...store.map.keys()]).toEqual(['claude_credentials_backup:default']);

    await rm(volume.credentialsPath);
    expect(await volume.restoreCredentialsIfMissing()).toBe(true);
    expect(await readFile(volume.credentialsPath, 'utf8')).toBe(original);
    if (process.platform !== 'win32') {
      expect((await stat(volume.credentialsPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('does not overwrite an existing file or restore nothing', async () => {
    const store = fakeStore();
    const volume = createCredentialsVolume({ dir, store });
    expect(await volume.restoreCredentialsIfMissing()).toBe(false);
    await writeFile(volume.credentialsPath, creds(5));
    await store.put('claude_credentials_backup', 'default', creds(9));
    expect(await volume.restoreCredentialsIfMissing()).toBe(false);
    expect(await readFile(volume.credentialsPath, 'utf8')).toBe(creds(5));
  });

  it('refuses to back up an invalid file', async () => {
    const store = fakeStore();
    const volume = createCredentialsVolume({ dir, store });
    await writeFile(volume.credentialsPath, 'garbage');
    expect(await volume.backupCredentials()).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('leaves no temp file after an atomic write', async () => {
    const volume = createCredentialsVolume({ dir, store: fakeStore() });
    await volume.writeCredentialsAtomic(creds(1));
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['.credentials.json']);
  });
});

describe('credentials watcher', () => {
  it('backs up on its initial tick', async () => {
    const store = fakeStore();
    const volume = createCredentialsVolume({ dir, store });
    await writeFile(volume.credentialsPath, creds(Date.now() + 1000));
    const stop = volume.startCredentialsWatcher(60_000);
    try {
      await vi.waitFor(() => expect(store.map.size).toBe(1));
    } finally {
      stop();
    }
  });
});

describe('claudeStatus', () => {
  const hour = 3_600_000;
  const statusFor = async (expiresAt: number, mtimeAgoMs: number) => {
    const volume = createCredentialsVolume({ dir, store: fakeStore() });
    await writeFile(volume.credentialsPath, creds(expiresAt));
    const mtime = new Date(Date.now() - mtimeAgoMs);
    await utimes(volume.credentialsPath, mtime, mtime);
    return claudeStatus(volume);
  };

  it('is missing without a file', async () => {
    const volume = createCredentialsVolume({ dir, store: fakeStore() });
    expect((await claudeStatus(volume)).state).toBe('missing');
  });

  it('is connected while the token is valid', async () => {
    const status = await statusFor(Date.now() + hour, 5 * hour);
    expect(status).toMatchObject({ state: 'connected', plan: 'max' });
  });

  it('is expired when expiresAt passed and the file is older than 1 h', async () => {
    expect((await statusFor(Date.now() - hour, 2 * hour)).state).toBe('expired');
  });

  it('stays connected when expired but the file was refreshed recently', async () => {
    expect((await statusFor(Date.now() - 1000, 60_000)).state).toBe('connected');
  });

  it('never includes token fields', async () => {
    const status = await statusFor(Date.now() + hour, 0);
    const json = JSON.stringify(status);
    expect(json).not.toContain('SECRET');
    expect(Object.keys(status).sort()).toEqual([
      'accountEmailMasked',
      'expiresAt',
      'lastRefreshAt',
      'plan',
      'state',
    ]);
  });
});
