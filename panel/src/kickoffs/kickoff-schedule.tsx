'use client';

import { startTransition, useOptimistic, useRef } from 'react';
import { notifyError, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { useClock } from '@/time/use-clock';
import { SectionLabel } from '@/ui/section-label';
import type { KickoffActionResult } from './kickoff-actions';
import { applyKickoffChange, type KickoffChange } from './kickoff-changes';
import { KickoffForm } from './kickoff-form';
import { KickoffList } from './kickoff-list';
import type { KickoffView } from './kickoff-view';

/** Applies `change` at once, then calls the server; on a refusal the change rolls back and a toast says why. */
export type RunKickoffChange = (change: KickoffChange, call: () => Promise<KickoffActionResult>) => void;

/**
 * The kick-off form and the upcoming list, sharing one optimistic list: adding, moving or removing a kick-off
 * shows at once, and the revalidated page (or a rollback on failure) replaces it when the server answers.
 */
export function KickoffSchedule({
  rows,
  timeZone,
  now,
  defaultLocal,
}: {
  rows: readonly KickoffView[];
  timeZone: string;
  now: Date;
  defaultLocal: string;
}) {
  const [shown, change] = useOptimistic<KickoffView[], KickoffChange>([...rows], applyKickoffChange);
  // Relative times ("in 6 h") keep moving after the server render.
  const clock = useClock(now);
  const pendingSeq = useRef(0);

  const run: RunKickoffChange = (optimistic, call) => {
    startTransition(async () => {
      change(optimistic);
      try {
        const result = await call();
        if (!result.ok) notifyError(result.error);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  };

  return (
    <>
      <KickoffForm
        timeZone={timeZone}
        defaultLocal={defaultLocal}
        run={run}
        nextPendingId={() => `pending-${(pendingSeq.current += 1)}`}
      />
      <section className="flex flex-col gap-2">
        <SectionLabel>Upcoming</SectionLabel>
        <KickoffList rows={shown} timeZone={timeZone} now={clock} run={run} />
      </section>
    </>
  );
}
