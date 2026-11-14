import type { Db } from '@/db/client';
import type { KickoffRow } from '@/db/schema';
import type { LiveEvent } from '@/live/event-bus';
import { formatHourMinute } from '@/time/clock-time';
import type { UsageResult } from '@/usage/usage-client';
import { effectiveWindow } from '@/usage/usage-format';
import type { KickoffContainerResult } from './kickoff-container';
import { claimDueKickoffs, failInterrupted, finishKickoff } from './kickoff-store';

const MISSED_AFTER_MS = 30 * 60_000;

export type KickoffJobDeps = {
  db: Db;
  runContainer: () => Promise<KickoffContainerResult>;
  getUsage: () => Promise<UsageResult>;
  refreshUsage: () => Promise<UsageResult>;
  publish: (event: LiveEvent) => void;
  timeZone: () => Promise<string>;
};

/** A window this run has started: its reset, or null when usage could not say. */
type StartedWindow = { resetsAt: Date | null };

/**
 * Runs every due kick-off. Only the first one in a run may start a window;
 * later ones find it running and are skipped.
 */
export async function runKickoffJob(deps: KickoffJobDeps, now: Date): Promise<void> {
  const interrupted = await failInterrupted(deps.db, now);
  const due = (await claimDueKickoffs(deps.db, now)).sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  if (interrupted === 0 && due.length === 0) return;

  try {
    const timeZone = await deps.timeZone();
    let started: StartedWindow | null = null;
    for (const row of due) {
      try {
        started = await handleKickoff(deps, row, now, timeZone, started);
      } catch (error) {
        // Finish it now: left `running`, it would later be failed as "Interrupted", which is not what happened.
        console.error('[schedule] a kick-off failed:', error instanceof Error ? error.name : 'error');
        await finishKickoff(deps.db, row.id, { status: 'failed', outcome: 'Failed: internal error' }).catch(() => undefined);
      }
    }
  } finally {
    deps.publish({ kind: 'kickoffs' });
  }
}

async function handleKickoff(
  deps: KickoffJobDeps,
  row: KickoffRow,
  now: Date,
  timeZone: string,
  started: StartedWindow | null,
): Promise<StartedWindow | null> {
  const clock = (date: Date) => formatHourMinute(date, timeZone);

  if (now.getTime() - row.runAt.getTime() > MISSED_AFTER_MS) {
    await finishKickoff(deps.db, row.id, {
      status: 'failed',
      outcome: `Missed: the panel was down at ${clock(row.runAt)}`,
    });
    return started;
  }

  const runningUntil = started ? started.resetsAt : await currentWindowReset(deps, now);
  if (started || runningUntil) {
    await finishKickoff(deps.db, row.id, {
      status: 'skipped',
      outcome: runningUntil
        ? `Skipped: window already running, resets ${clock(runningUntil)}`
        : 'Skipped: window already running',
    });
    return started;
  }

  const result = await deps.runContainer();
  if (!result.ok) {
    await finishKickoff(deps.db, row.id, { status: 'failed', outcome: `Failed: ${result.reason}` });
    return started;
  }
  const resetsAt = (await deps.refreshUsage().catch(() => null))?.snapshot?.fiveHour.resetsAt ?? null;
  await finishKickoff(deps.db, row.id, {
    status: 'started',
    outcome: resetsAt ? `Window started ${clock(now)}, resets ${clock(resetsAt)}` : `Window started ${clock(now)}`,
    windowResetsAt: resetsAt,
  });
  return { resetsAt };
}

/** The reset of the 5-hour window when one is running now; null when idle or usage is unknown. */
async function currentWindowReset(deps: KickoffJobDeps, now: Date): Promise<Date | null> {
  const snapshot = (await deps.getUsage().catch(() => null))?.snapshot;
  if (!snapshot) return null;
  const window = effectiveWindow(snapshot.fiveHour, now);
  return window.pct > 0 && window.resetsAt && window.resetsAt.getTime() > now.getTime() ? window.resetsAt : null;
}
