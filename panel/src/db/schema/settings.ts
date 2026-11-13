import { sql } from 'drizzle-orm';
import { check, integer, pgTable, real, text } from 'drizzle-orm/pg-core';

export const usageResetDisplays = ['countdown', 'clock'] as const;
export type UsageResetDisplay = (typeof usageResetDisplays)[number];

export const settings = pgTable(
  'settings',
  {
    id: integer().primaryKey().default(1),
    maxRunning: integer().notNull(),
    cpuPerSession: real().notNull(),
    memoryGbPerSession: integer().notNull(),
    diskGbPerSession: integer().notNull(),
    minFreeDiskGb: integer().notNull(),
    usageResetDisplay: text().$type<UsageResetDisplay>().notNull(),
    usageWarnPct: integer().notNull(),
    usageDangerPct: integer().notNull(),
    timeZone: text().notNull(),
  },
  (t) => [
    check('settings_single_row', sql`${t.id} = 1`),
    check('settings_usage_reset_display_check', sql`${t.usageResetDisplay} in ('countdown', 'clock')`),
  ],
);
