'use client';

import { Button } from '@heroui/react';
import { Play, RotateCcw, Square } from 'lucide-react';
import { useOptimistic, useTransition } from 'react';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { AutoResumeField } from './auto-resume-field';
import { ClearSessionDialog } from './clear-session-dialog';
import { holdsRunningSlot } from './running-statuses';
import { DeleteSessionDialog } from './delete-session-dialog';
import { setAutoResumeAction } from './session-actions';
import { useSessionLive } from './session-live-context';
import { LiveOpenInClaude } from './session-status-badge';

/** Stop / Restart (or Start again) / Resume now / Delete. Stop and Restart are optimistic; see SessionLiveProvider. */
function SessionButtons({ compact }: { compact: boolean }) {
  const { status, pending, hasContainer, limitState, run } = useSessionLive();
  const running = holdsRunningSlot(status);
  const canResumeNow = running && hasContainer && (limitState === 'limited' || limitState === 'failed');
  const busy = pending !== null;
  return (
    <>
      {running ? (
        <Button
          variant="secondary"
          isDisabled={busy}
          isPending={pending === 'stop'}
          onPress={() => run('stop')}
          className="min-h-11 gap-2"
        >
          <Square aria-hidden className="size-4" />
          {compact ? 'Stop' : 'Stop (keeps the workspace)'}
        </Button>
      ) : null}
      {hasContainer ? (
        <Button
          variant={running ? 'tertiary' : 'secondary'}
          isDisabled={busy}
          isPending={pending === 'restart'}
          onPress={() => run('restart')}
          className="min-h-11 gap-2"
        >
          <RotateCcw aria-hidden className="size-4" />
          {running ? 'Restart' : 'Start again'}
        </Button>
      ) : null}
      {canResumeNow ? (
        <Button variant="secondary" isDisabled={busy} isPending={pending === 'resume'} onPress={() => run('resume')} className="min-h-11 gap-2">
          <Play aria-hidden className="size-4" />
          Resume now
        </Button>
      ) : null}
      {running ? <ClearSessionDialog /> : null}
      <DeleteSessionDialog />
    </>
  );
}

/** Desktop: the Overview's Controls column. */
export function SessionControls() {
  return (
    <div className="flex flex-wrap gap-3">
      <SessionButtons compact={false} />
    </div>
  );
}

/**
 * Below lg: primary actions pinned to the bottom of the screen on every tab of a session (spec call #5).
 * Open in Claude takes the width; the rest stay one thumb away.
 */
export function SessionActionBar() {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-10 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:hidden">
      <LiveOpenInClaude className="min-w-40 flex-1" />
      <SessionButtons compact />
    </div>
  );
}

/** The per-session auto-resume switch: flips at once, snaps back and says why when the server refuses. */
export function SessionAutoResumeSwitch() {
  const { id, autoResume } = useSessionLive();
  const [selected, setSelected] = useOptimistic(autoResume);
  const [, startTransition] = useTransition();

  function change(enabled: boolean) {
    startTransition(async () => {
      setSelected(enabled);
      try {
        const result = await setAutoResumeAction(id, enabled);
        if (result.ok) notifySuccess(result.message);
        else notifyError(result.message);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  return <AutoResumeField isSelected={selected} onChange={change} />;
}
