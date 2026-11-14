import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';

/** The last good usage reading, so a restart or a failing endpoint never blanks the header. */
export const usageCache = pgTable(
  'usage_cache',
  {
    id: integer().primaryKey().default(1),
    snapshot: jsonb().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [check('usage_cache_single_row', sql`${t.id} = 1`)],
);
