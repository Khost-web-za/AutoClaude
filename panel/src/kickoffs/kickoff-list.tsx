'use client';

import { Button, Input } from '@heroui/react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useOptimistic, useRef, useState } from 'react';
import { notifyError, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { useLive } from '@/live/use-live';
import { formatClock } from '@/time/clock-time';
import { formatRelative } from '@/time/relative-time';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';
import { removeKickoffAction, rescheduleKickoffAction, type KickoffActionResult } from './kickoff-actions';
import type { KickoffView } from './kickoff-view';

const REFRESH_DEBOUNCE_MS = 500;

type Change = { type: 'remove'; id: string } | { type: 'move'; id: string; runAt: string };

function applyChange(rows: KickoffView[], change: Change): KickoffView[] {
  if (change.type === 'remove') return rows.filter((row) => row.id !== change.id);
  return rows
    .map((row) => (row.id === change.id ? { ...row, runAt: change.runAt } : row))
    .sort((a, b) => a.runAt.localeCompare(b.runAt));
}

/**
 * The scheduled kick-offs, soonest first. Removing or moving one shows at once (optimistic); if the
 * server says no, the row comes back and a toast says why. Refreshes the page data on `kickoffs` events.
 */
export function KickoffList({ rows, timeZone, now }: { rows: readonly KickoffView[]; timeZone: string; now: Date }) {
  const router = useRouter();
  const [shown, change] = useOptimistic<KickoffView[], Change>([...rows], applyChange);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLive((event) => {
    if (event.kind !== 'kickoffs') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run(optimistic: Change, call: () => Promise<KickoffActionResult>) {
    startTransition(async () => {
      change(optimistic);
      try {
        const result = await call();
        if (!result.ok) notifyError(result.error);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  function startEdit(row: KickoffView) {
    setDraft(instantToWallTime(new Date(row.runAt), timeZone));
    setEditing(row.id);
  }

  function saveEdit(row: KickoffView) {
    if (!draft) return;
    setEditing(null);
    run({ type: 'move', id: row.id, runAt: wallTimeToInstant(draft, timeZone).toISOString() }, () =>
      rescheduleKickoffAction(row.id, draft),
    );
  }

  if (shown.length === 0) return <p className="py-4 text-sm text-muted">Nothing scheduled.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {shown.map((row) => {
        const runAt = new Date(row.runAt);
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            {editing === row.id ? (
              <>
                <Input
                  type="datetime-local"
                  aria-label="New start time"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-11 min-w-0 flex-1"
                />
                <Button isIconOnly variant="primary" aria-label="Save time" className="size-11" onPress={() => saveEdit(row)}>
                  <Check aria-hidden className="size-4" />
                </Button>
                <Button isIconOnly variant="tertiary" aria-label="Cancel" className="size-11" onPress={() => setEditing(null)}>
                  <X aria-hidden className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-sm font-semibold text-white">{formatClock(runAt, timeZone)}</span>
                <span className="text-xs text-text-subtle">{formatRelative(runAt, now)}</span>
                <Button isIconOnly variant="tertiary" aria-label="Change time" className="size-11" onPress={() => startEdit(row)}>
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  isIconOnly
                  variant="danger-soft"
                  aria-label="Remove kick-off"
                  className="size-11"
                  onPress={() => run({ type: 'remove', id: row.id }, () => removeKickoffAction(row.id))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
