import type { KickoffRow, KickoffStatus } from '@/db/schema';

/** A kick-off as the browser gets it: plain data, the time as an ISO instant. */
export type KickoffView = {
  id: string;
  runAt: string;
  status: KickoffStatus;
  outcome: string | null;
  /** Only on the browser's optimistic placeholder for a kick-off still being saved. */
  pending?: true;
};

export function toKickoffView(row: KickoffRow): KickoffView {
  return { id: row.id, runAt: row.runAt.toISOString(), status: row.status, outcome: row.outcome };
}
