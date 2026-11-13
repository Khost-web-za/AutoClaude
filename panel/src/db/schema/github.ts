import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const githubApp = pgTable(
  'github_app',
  {
    id: integer().primaryKey().default(1),
    appId: bigint({ mode: 'number' }).notNull(),
    slug: text().notNull(),
    clientId: text().notNull(),
    ownerLogin: text().notNull(),
    htmlUrl: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('github_app_single_row', sql`${t.id} = 1`)],
);

export const githubInstallations = pgTable('github_installations', {
  installationId: bigint({ mode: 'number' }).primaryKey(),
  accountLogin: text().notNull(),
  accountType: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
