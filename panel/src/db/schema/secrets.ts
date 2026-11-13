import { customType, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const secretKinds = [
  'repo',
  'github_app_private_key',
  'github_app_client_secret',
  'github_app_webhook_secret',
  'github_user_token',
  'claude_credentials_backup',
] as const;

export type SecretKind = (typeof secretKinds)[number];

export const secrets = pgTable(
  'secrets',
  {
    kind: text().$type<SecretKind>().notNull(),
    ref: text().notNull(),
    ciphertext: bytea().notNull(),
    nonce: bytea().notNull(),
    keyVersion: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'secrets_pkey', columns: [t.kind, t.ref] })],
);
