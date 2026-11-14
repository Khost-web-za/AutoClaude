'use client';

import { Button, Input } from '@heroui/react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '@/live/use-live';
import { formatClock } from '@/time/clock-time';
import { formatRelative } from '@/time/relative-time';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';
import { removeKickoffAction, rescheduleKickoffAction } from './kickoff-actions';
import type { RunKickoffChange } from './kickoff-schedule';
import type { KickoffView } from './kickoff-view';

const REFRESH_DEBOUNCE_MS = 500;

/**
 * The scheduled kick-offs, soonest first, as KickoffSchedule shows them (optimistic). Removing or moving one
 * goes through `run`; a row still being added cannot be changed yet. Refreshes the page data on `kickoffs` events.
 */
export function KickoffList({
  rows,
  timeZone,
  now,
  run,
}: {
  rows: readonly KickoffView[];
  timeZone: string;
  now: Date;
  run: RunKickoffChange;
}) {
  const router = useRouter();
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

  if (rows.length === 0) return <p className="py-4 text-sm text-muted">Nothing scheduled.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => {
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
                <Button
                  isIconOnly
                  variant="tertiary"
                  aria-label="Change time"
                  className="size-11"
                  isDisabled={row.pending}
                  onPress={() => startEdit(row)}
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  isIconOnly
                  variant="danger-soft"
                  aria-label="Remove kick-off"
                  className="size-11"
                  isDisabled={row.pending}
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
