import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { secrets } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { SecretDecryptError } from '@/secret-store/crypto';
import { createSecretStore } from '@/secret-store/secret-store';

const key = randomBytes(32);

describe('secret store', () => {
  it('put/get round trip, and null for a missing secret', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'acme/widgets:ENV', 's3cret value');
      expect(await store.get('repo', 'acme/widgets:ENV')).toBe('s3cret value');
      expect(await store.get('repo', 'nope')).toBeNull();
      const [row] = await db.select().from(secrets);
      expect(row?.ciphertext.toString('utf8')).not.toContain('s3cret');
    }));

  it('listNames never returns values', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'acme/a:ONE', 'v1');
      await store.put('repo', 'acme/a:TWO', 'v2');
      await store.put('repo', 'acme/b:ONE', 'v3');
      const list = await store.listNames('repo', 'acme/a:');
      expect(list.map((r) => r.ref).sort()).toEqual(['acme/a:ONE', 'acme/a:TWO']);
      for (const item of list) {
        expect(Object.keys(item).sort()).toEqual(['ref', 'updatedAt']);
        expect(item.updatedAt).toBeInstanceOf(Date);
      }
    }));

  it('listNamesPage pages names by ref, never values, and the prefix is literal', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      for (let i = 0; i < 23; i += 1) await store.put('repo', `acme/a:K${String(i).padStart(2, '0')}`, `v${i}`);
      await store.put('repo', 'acme/b:K00', 'other');
      await store.put('repo', 'acme_a:K00', 'wildcard');
      const first = await store.listNamesPage('repo', 'acme/a:', 1);
      expect(first).toMatchObject({ page: 1, pageSize: 20, total: 23, pageCount: 2 });
      expect(first.items[0]?.ref).toBe('acme/a:K00');
      for (const item of first.items) expect(Object.keys(item).sort()).toEqual(['ref', 'updatedAt']);
      const second = await store.listNamesPage('repo', 'acme/a:', 2);
      expect(second.items.map((r) => r.ref)).toEqual(['acme/a:K20', 'acme/a:K21', 'acme/a:K22']);
    }));

  it('getMany returns decrypted values for a prefix; prefix wildcards are literal', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'acme/a:ONE', 'v1');
      await store.put('repo', 'acmeXa:ONE', 'bad');
      await store.put('repo', 'acme/b:ONE', 'v3');
      expect(await store.getMany('repo', 'acme/a:')).toEqual({ 'acme/a:ONE': 'v1' });
      expect(await store.getMany('repo', 'acme_a:')).toEqual({});
    }));

  it('a row copied to another ref fails to decrypt', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'acme/a:ONE', 'v1');
      const [row] = await db.select().from(secrets);
      await db.insert(secrets).values({ ...row!, ref: 'acme/a:TWO' });
      await expect(store.get('repo', 'acme/a:TWO')).rejects.toBeInstanceOf(SecretDecryptError);
    }));

  it('put overwrites and bumps updated_at', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'r', 'one');
      const [first] = await store.listNames('repo', 'r');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await store.put('repo', 'r', 'two');
      const [second] = await store.listNames('repo', 'r');
      expect(await store.get('repo', 'r')).toBe('two');
      expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
      expect(await db.select().from(secrets)).toHaveLength(1);
    }));

  it('remove deletes only the targeted secret', () =>
    withTestDb(async ({ db }) => {
      const store = createSecretStore({ db, key });
      await store.put('repo', 'a', '1');
      await store.put('repo', 'b', '2');
      await store.remove('repo', 'a');
      expect(await store.get('repo', 'a')).toBeNull();
      expect(await store.get('repo', 'b')).toBe('2');
      expect(await db.select().from(secrets)).toHaveLength(1);
    }));
});
