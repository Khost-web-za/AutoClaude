import type { KickoffView } from './kickoff-view';

/** An optimistic change to the upcoming kick-offs, shown until the server's answer replaces it. */
export type KickoffChange =
  | { type: 'add'; row: KickoffView }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; runAt: string };

const byRunAt = (a: KickoffView, b: KickoffView) => a.runAt.localeCompare(b.runAt);

export function applyKickoffChange(rows: KickoffView[], change: KickoffChange): KickoffView[] {
  switch (change.type) {
    case 'add':
      return [...rows, change.row].sort(byRunAt);
    case 'remove':
      return rows.filter((row) => row.id !== change.id);
    case 'move':
      return rows.map((row) => (row.id === change.id ? { ...row, runAt: change.runAt } : row)).sort(byRunAt);
  }
}

/** The placeholder row an Add shows while the server saves it. */
export function pendingKickoff(id: string, runAt: Date): KickoffView {
  return { id, runAt: runAt.toISOString(), status: 'scheduled', outcome: null, pending: true };
}
