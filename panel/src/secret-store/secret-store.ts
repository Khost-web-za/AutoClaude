import { and, eq, like, sql } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { paginate, type PageResult } from '@/db/pagination';
import { secrets, type SecretKind } from '@/db/schema';
import { getPanelEnv } from '@/env/panel-env';
import { decrypt, encrypt } from './crypto';

const CURRENT_KEY_VERSION = 1;

const aadFor = (kind: SecretKind, ref: string) => `${kind}:${ref}`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => '\\' + char);

type SecretRow = typeof secrets.$inferSelect;

export function createSecretStore(deps: { db: Db; key: Buffer; keyVersion?: number }) {
  const { db, key, keyVersion = CURRENT_KEY_VERSION } = deps;

  const open = (row: SecretRow) => decrypt(row, key, aadFor(row.kind, row.ref)).toString('utf8');

  return {
    async put(kind: SecretKind, ref: string, value: string): Promise<void> {
      const box = encrypt(Buffer.from(value, 'utf8'), key, keyVersion, aadFor(kind, ref));
      await db
        .insert(secrets)
        .values({ kind, ref, ...box })
        .onConflictDoUpdate({
          target: [secrets.kind, secrets.ref],
          set: { ...box, updatedAt: sql`now()` },
        });
    },

    async get(kind: SecretKind, ref: string): Promise<string | null> {
      const [row] = await db
        .select()
        .from(secrets)
        .where(and(eq(secrets.kind, kind), eq(secrets.ref, ref)));
      return row ? open(row) : null;
    },

    /** Names and timestamps only; never selects ciphertext. */
    async listNames(
      kind: SecretKind,
      refPrefix: string,
    ): Promise<{ ref: string; updatedAt: Date }[]> {
      return db
        .select({ ref: secrets.ref, updatedAt: secrets.updatedAt })
        .from(secrets)
        .where(and(eq(secrets.kind, kind), like(secrets.ref, `${escapeLike(refPrefix)}%`)))
        .orderBy(secrets.ref);
    },

    /** One page (20, by ref) of names and timestamps; never selects ciphertext. For the UI lists. */
    async listNamesPage(
      kind: SecretKind,
      refPrefix: string,
      page: number,
    ): Promise<PageResult<{ ref: string; updatedAt: Date }>> {
      return paginate(
        db,
        () =>
          db
            .select({ ref: secrets.ref, updatedAt: secrets.updatedAt })
            .from(secrets)
            .where(and(eq(secrets.kind, kind), like(secrets.ref, `${escapeLike(refPrefix)}%`)))
            .orderBy(secrets.ref)
            .$dynamic(),
        { page },
      );
    },

    async remove(kind: SecretKind, ref: string): Promise<void> {
      await db.delete(secrets).where(and(eq(secrets.kind, kind), eq(secrets.ref, ref)));
    },

    async getMany(kind: SecretKind, refPrefix: string): Promise<Record<string, string>> {
      const rows = await db
        .select()
        .from(secrets)
        .where(and(eq(secrets.kind, kind), like(secrets.ref, `${escapeLike(refPrefix)}%`)));
      return Object.fromEntries(rows.map((row) => [row.ref, open(row)]));
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;

let shared: SecretStore | undefined;
const sharedStore = () =>
  (shared ??= createSecretStore({ db: sharedDb, key: getPanelEnv().encryptionKey }));

/** The app's store, bound to the shared pool and PANEL_ENCRYPTION_KEY on first use. */
export const secretStore: SecretStore = {
  put: (...args) => sharedStore().put(...args),
  get: (...args) => sharedStore().get(...args),
  listNames: (...args) => sharedStore().listNames(...args),
  listNamesPage: (...args) => sharedStore().listNamesPage(...args),
  remove: (...args) => sharedStore().remove(...args),
  getMany: (...args) => sharedStore().getMany(...args),
};
