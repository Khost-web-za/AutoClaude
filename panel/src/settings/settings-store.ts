import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { db, type Db, type Tx } from '@/db/client';
import { settings } from '@/db/schema';
import type { SettingsInput } from './settings-schemas';

/** The panel-wide settings (the single `settings` row without its id). */
export type Settings = Omit<typeof settings.$inferSelect, 'id'>;

const COLUMNS = {
  maxRunning: settings.maxRunning,
  cpuPerSession: settings.cpuPerSession,
  memoryGbPerSession: settings.memoryGbPerSession,
  diskGbPerSession: settings.diskGbPerSession,
  minFreeDiskGb: settings.minFreeDiskGb,
  usageResetDisplay: settings.usageResetDisplay,
  usageWarnPct: settings.usageWarnPct,
  usageDangerPct: settings.usageDangerPct,
  timeZone: settings.timeZone,
};

/** Reads the row through any connection or transaction (the capacity check reads it under its lock). */
export async function readSettings(conn: Db | Tx): Promise<Settings> {
  const [row] = await conn.select(COLUMNS).from(settings).limit(1);
  if (!row) throw new Error('settings row is missing (migrations not applied?)');
  return row;
}

/** The settings for this request: read once per render, however many components ask. */
export const getSettings = cache((): Promise<Settings> => readSettings(db));

/** Writes validated values. The row always exists (seeded by migration 0001). */
export async function saveSettings(values: SettingsInput, conn: Db = db): Promise<void> {
  await conn.update(settings).set(values).where(eq(settings.id, 1));
}
