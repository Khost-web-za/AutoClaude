import { db } from '@/db/client';
import { usageCache } from '@/db/schema';
import type { UsageSnapshot, UsageWindow } from './usage-types';

type StoredWindow = { pct: number; resetsAt: string | null };
type StoredSnapshot = {
  fiveHour: StoredWindow;
  weekly: StoredWindow;
  extra: (StoredWindow & { label: string })[];
  fetchedAt: string;
};

const reviveWindow = (window: StoredWindow): UsageWindow => ({
  pct: window.pct,
  resetsAt: window.resetsAt ? new Date(window.resetsAt) : null,
});

/** JSON turns the snapshot's dates into strings; this restores them. */
export function reviveStoredSnapshot(stored: unknown): UsageSnapshot | null {
  const raw = stored as Partial<StoredSnapshot> | null;
  if (!raw?.fiveHour || !raw.weekly || !Array.isArray(raw.extra) || typeof raw.fetchedAt !== 'string') return null;
  const fetchedAt = new Date(raw.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return null;
  return {
    fiveHour: reviveWindow(raw.fiveHour),
    weekly: reviveWindow(raw.weekly),
    extra: raw.extra.map((window) => ({ ...reviveWindow(window), label: window.label })),
    fetchedAt,
  };
}

/** Errors are logged and swallowed: a database hiccup must not take usage down. */
export async function loadLastUsage(): Promise<UsageSnapshot | null> {
  try {
    const [row] = await db.select({ snapshot: usageCache.snapshot }).from(usageCache).limit(1);
    return row ? reviveStoredSnapshot(row.snapshot) : null;
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
