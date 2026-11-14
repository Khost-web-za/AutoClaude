'use client';

import { Eraser } from 'lucide-react';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useSessionLive } from './session-live-context';

/** Clear behind a confirmation. Offered only to an idle Claude (the server refuses otherwise). */
export function ClearSessionDialog() {
  const { status, pending, run } = useSessionLive();
  return (
    <ConfirmDialog
      trigger={
        <>
          <Eraser aria-hidden className="size-4" />
          Clear
        </>
      }
      triggerVariant="tertiary"
      title="Clear Claude's conversation?"
      description="Claude starts a fresh conversation and pulls the latest from the remote. Committed work is kept."
      confirmLabel="Clear"
      isDisabled={status !== 'idle' || pending !== null}
      onConfirm={() => run('clear')}
    />
  );
}
