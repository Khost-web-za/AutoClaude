import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getPanelEnv } from '@/env/panel-env';
import * as schema from './schema';

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle({ client, schema, casing: 'snake_case' });
  return { db, client, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let shared: Db | undefined;

/** The app's single pool. Created on first use so importing this module never needs the environment. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    shared ??= createDb(getPanelEnv().databaseUrl).db;
    return Reflect.get(shared, prop, shared) as unknown;
  },
});
