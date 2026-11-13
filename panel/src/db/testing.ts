import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type Db } from './client';
import { runMigrations } from './migrate';

/**
 * Runs `fn` against a throwaway database (on the server DATABASE_URL points at), migrated from empty.
 * The database is created here and dropped afterwards; no other database is touched.
 */
export async function withTestDb<T>(fn: (ctx: { db: Db; url: string }) => Promise<T>): Promise<T> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is required for integration tests (see .env.local)');
  const name = `claudecloud_test_${randomBytes(6).toString('hex')}`;
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;

  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await runMigrations({ url: url.toString() });
    const { db, close } = createDb(url.toString(), { max: 2 });
    try {
      return await fn({ db, url: url.toString() });
    } finally {
      await close();
    }
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
