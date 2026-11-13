import { integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions';

export const sessionProfiles = pgTable(
  'session_profiles',
  {
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    profile: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [primaryKey({ name: 'session_profiles_pkey', columns: [t.sessionId, t.profile] })],
);
