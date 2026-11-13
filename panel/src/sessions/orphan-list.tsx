'use client';

import { Box } from 'lucide-react';
import { startTransition, useOptimistic } from 'react';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { removeOrphanAction } from './orphan-actions';
import type { OrphanContainer } from './reconcile';

/**
 * One page of orphan containers. A confirmed removal dims its row at once (optimistic); the refreshed
 * list drops it on success. On failure the row comes back, the dialog stays open and a toast says why.
 */
export function OrphanList({ orphans }: { orphans: readonly OrphanContainer[] }) {
  const [removing, markRemoving] = useOptimistic<ReadonlySet<string>, string>(
    new Set(),
    (current, id) => new Set([...current, id]),
  );

  function remove(containerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      startTransition(async () => {
        markRemoving(containerId);
        try {
          const result = await removeOrphanAction(containerId);
          if (result.ok) {
            notifySuccess(result.message);
            resolve();
            return;
          }
          notifyError(result.message);
        } catch {
          notifyError(UNREACHABLE_MESSAGE);
        }
        reject(new Error('remove failed'));
      });
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {orphans.map((orphan) => {
        const isRemoving = removing.has(orphan.containerId);
        return (
          <li
            key={orphan.containerId}
            aria-busy={isRemoving || undefined}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 transition-opacity motion-reduce:transition-none ${isRemoving ? 'opacity-40' : ''}`}
          >
            <Box aria-hidden className="size-4 shrink-0 text-text-subtle" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-white">{orphan.name}</span>
            <span className="font-mono text-xs text-text-subtle">{orphan.containerId.slice(0, 12)}</span>
            <span className="text-xs text-muted">{isRemoving ? 'removing…' : orphan.state}</span>
            <ConfirmDialog
              trigger="Remove"
              title={`Remove ${orphan.name}?`}
              description="The container and its session's Docker volume are deleted for good, with anything in its workspace. No session in the panel uses it."
              confirmLabel="Remove container"
              danger
              triggerVariant="danger-soft"
              isDisabled={isRemoving}
              onConfirm={() => remove(orphan.containerId)}
            />
          </li>
        );
      })}
    </ul>
  );
}
