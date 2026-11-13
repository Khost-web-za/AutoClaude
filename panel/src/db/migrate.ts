import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

/**
 * Applies pending migrations. Callable from a standalone entry (the Docker image runs it before the
 * server), so it only needs DATABASE_URL, and the folder is resolved from the working directory
 * (the app root) rather than from a bundled module path.
 */
export async function runMigrations(
  options: { url?: string; migrationsFolder?: string } = {},
): Promise<void> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations');
  const migrationsFolder =
    options.migrationsFolder ?? process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
