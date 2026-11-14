import { pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

export const sessionDelivery = pgEnum('session_delivery', ['pull_request', 'push']);

export type DeliveryMode = (typeof sessionDelivery.enumValues)[number];

export const repoSettings = pgTable('repo_settings', {
  repoFullName: text().primaryKey(),
  defaultBaseBranch: text(),
  defaultProfiles: text().array().notNull().default([]),
  deliveryMode: sessionDelivery().notNull().default('pull_request'),
});
