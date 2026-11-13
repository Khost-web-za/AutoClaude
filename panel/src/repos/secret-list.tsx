'use client';

import { KeyRound } from 'lucide-react';
import { startTransition, useOptimistic } from 'react';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { deleteRepoSecret } from './secret-actions';

export type SecretNameRow = { name: string; updated: string };

/**
 * One page of secret names (never values). A confirmed delete dims its row at once (optimistic); the
 * refreshed list drops it on success, and on failure the row comes back, the dialog stays open and a
 * toast says why. The row stays mounted meanwhile so its dialog can honour "stays open on failure".
 */
export function SecretList({ repo, rows }: { repo: string; rows: readonly SecretNameRow[] }) {
  const [deleting, markDeleting] = useOptimistic<ReadonlySet<string>, string>(
    new Set(),
    (current, name) => new Set([...current, name]),
  );

  function remove(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      startTransition(async () => {
        markDeleting(name);
        try {
          const result = await deleteRepoSecret(repo, name);
          if (result.status === 'success') {
            notifySuccess(result.message);
            resolve();
            return;
          }
          notifyError(result.status === 'error' ? result.message : UNREACHABLE_MESSAGE);
        } catch {
          notifyError(UNREACHABLE_MESSAGE);
        }
        reject(new Error('delete failed'));
      });
    });
  }

  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted">No secrets on this page.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => {
        const isDeleting = deleting.has(row.name);
        return (
          <li
            key={row.name}
            aria-busy={isDeleting || undefined}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 transition-opacity motion-reduce:transition-none ${isDeleting ? 'opacity-40' : ''}`}
          >
            <KeyRound aria-hidden className="size-4 shrink-0 text-text-subtle" />
            <span className="min-w-0 flex-1 font-mono text-sm break-all text-white">{row.name}</span>
            <span className="text-xs text-text-subtle">{isDeleting ? 'deleting…' : `updated ${row.updated}`}</span>
            <ConfirmDialog
              trigger="Delete"
              title={`Delete ${row.name}?`}
              description="Sessions started from now on will not get this variable. Running sessions keep the value they already have."
              confirmLabel="Delete secret"
              danger
              triggerVariant="danger-soft"
              isDisabled={isDeleting}
              onConfirm={() => remove(row.name)}
            />
          </li>
        );
      })}
    </ul>
  );
}
