import { pgTable, text } from 'drizzle-orm/pg-core';

export const repoSettings = pgTable('repo_settings', {
  repoFullName: text().primaryKey(),
  defaultBaseBranch: text(),
  defaultProfiles: text().array().notNull().default([]),
});
