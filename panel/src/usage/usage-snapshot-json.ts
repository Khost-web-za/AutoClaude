import type { UsageSnapshot, UsageWindow } from './usage-types';

/** A snapshot after a JSON round trip (the saved reading, a live event): its dates are strings. */
type JsonWindow = { pct: number; resetsAt: string | null };
type JsonSnapshot = {
  fiveHour: JsonWindow;
  weekly: JsonWindow;
  extra: (JsonWindow & { label: string })[];
  fetchedAt: string;
};

const reviveWindow = (window: JsonWindow): UsageWindow => ({
  pct: window.pct,
  resetsAt: window.resetsAt ? new Date(window.resetsAt) : null,
});

/** Restores the dates of a snapshot that went through JSON; null when there is none or its shape is unknown. */
export function reviveSnapshot(json: unknown): UsageSnapshot | null {
  const raw = json as Partial<JsonSnapshot> | null;
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
