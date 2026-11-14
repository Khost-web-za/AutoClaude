import { db } from '@/db/client';
import { usageCache } from '@/db/schema';
import { reviveSnapshot } from './usage-snapshot-json';
import type { UsageSnapshot } from './usage-types';

/** Errors are logged and swallowed: a database hiccup must not take usage down. */
export async function loadLastUsage(): Promise<UsageSnapshot | null> {
  try {
    const [row] = await db.select({ snapshot: usageCache.snapshot }).from(usageCache).limit(1);
    return row ? reviveSnapshot(row.snapshot) : null;
  } catch (error) {
    console.error('[usage] could not load the saved reading:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function saveLastUsage(snapshot: UsageSnapshot): Promise<void> {
  try {
    await db
      .insert(usageCache)
      .values({ id: 1, snapshot, fetchedAt: snapshot.fetchedAt })
      .onConflictDoUpdate({ target: usageCache.id, set: { snapshot, fetchedAt: snapshot.fetchedAt } });
  } catch (error) {
    console.error('[usage] could not save the reading:', error instanceof Error ? error.message : error);
  }
}
