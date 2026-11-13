'use client';

import { Button } from '@heroui/react';
import { RotateCcw, Square } from 'lucide-react';
import { holdsRunningSlot } from './running-statuses';
import { DeleteSessionDialog } from './delete-session-dialog';
import { useSessionLive } from './session-live-context';
import { LiveOpenInClaude } from './session-status-badge';

/** Stop / Restart (or Start again) / Delete. Stop and Restart are optimistic; see SessionLiveProvider. */
function SessionButtons({ compact }: { compact: boolean }) {
  const { status, pending, hasContainer, run } = useSessionLive();
  const running = holdsRunningSlot(status);
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
