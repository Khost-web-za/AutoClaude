import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessions } from './sessions';

export const sessionEvents = pgTable(
  'session_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_events_session_id_id_idx').on(t.sessionId, t.id.desc())],
);
