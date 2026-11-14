import { boolean, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

/** What auto-resume types into Claude when a repository does not set its own. */
export const DEFAULT_RESUME_MESSAGE = 'Please continue where you left off.';

export const sessionDelivery = pgEnum('session_delivery', ['pull_request', 'push']);

export type DeliveryMode = (typeof sessionDelivery.enumValues)[number];

export const repoSettings = pgTable('repo_settings', {
  repoFullName: text().primaryKey(),
  defaultBaseBranch: text(),
  defaultProfiles: text().array().notNull().default([]),
  deliveryMode: sessionDelivery().notNull().default('pull_request'),
  autoResume: boolean().notNull().default(false),
  resumeMessage: text().notNull().default(DEFAULT_RESUME_MESSAGE),
});
