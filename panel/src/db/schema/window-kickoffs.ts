import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const kickoffStatus = pgEnum('kickoff_status', ['scheduled', 'running', 'started', 'skipped', 'failed']);
export type KickoffStatus = (typeof kickoffStatus.enumValues)[number];

/** A planned start of the 5-hour usage window, so the window resets when the user wants it to. */
export const windowKickoffs = pgTable(
  'window_kickoffs',
  {
    id: uuid().primaryKey().defaultRandom(),
    runAt: timestamp({ withTimezone: true }).notNull(),
    status: kickoffStatus().notNull().default('scheduled'),
    outcome: text(),
    windowResetsAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('window_kickoffs_status_run_at_idx').on(t.status, t.runAt)],
);

export type KickoffRow = typeof windowKickoffs.$inferSelect;
