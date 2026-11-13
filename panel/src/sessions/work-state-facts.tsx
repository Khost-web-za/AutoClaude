'use client';

import { Button } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import type { SessionGitState } from '@/db/schema';
import { notifyError, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { useLive } from '@/live/use-live';
import { formatAgo } from '@/time/relative-time';
import { FactsList } from '@/ui/facts-list';
import { refreshWorkStateAction } from './session-actions';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const AUTO_REFRESH_DEBOUNCE_MS = 1500;

/**
 * Unpushed / uncommitted / PR, read from the workspace with git. "Refresh" re-reads it; it is also
 * re-read when Claude finishes a turn (a live `idle` status), the moment work most often lands.
 */
export function WorkStateFacts({
  sessionId,
  initial,
  canRefresh,
}: {
  sessionId: string;
  initial: SessionGitState | null;
  canRefresh: boolean;
}) {
  const [state, setState] = useState({ initial, gitState: initial });
  if (state.initial !== initial) setState({ initial, gitState: initial });
  const gitState = state.initial === initial ? state.gitState : initial;
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh(quiet = false) {
    startTransition(async () => {
      try {
        const result = await refreshWorkStateAction(sessionId);
        if (result.ok) setState((current) => ({ ...current, gitState: result.gitState }));
        else if (!quiet) notifyError(result.message);
      } catch {
        if (!quiet) notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  useLive((event) => {
    if (!canRefresh || event.kind !== 'session' || event.sessionId !== sessionId || event.status !== 'idle') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => refresh(true), AUTO_REFRESH_DEBOUNCE_MS);
  });

  const muted = (text: string) => <span className="text-text-subtle">{text}</span>;
  const facts = !gitState
    ? [{ label: 'Checked', value: muted('Not checked yet') }]
    : gitState.error
      ? [{ label: 'Checked', value: <span className="text-warning">Can&apos;t read the workspace: {gitState.error}</span> }]
      : [
          {
            label: 'Unpushed',
            value:
              gitState.unpushedCommits > 0 ? (
                <span className="font-semibold text-warning">{plural(gitState.unpushedCommits, 'commit')}</span>
              ) : (
                muted('none')
              ),
          },
          {
            label: 'Uncommitted',
            value: gitState.uncommittedFiles > 0 ? plural(gitState.uncommittedFiles, 'file') : muted('none'),
          },
          {
            label: 'Pull request',
            value: gitState.prUrl ? (
              <a href={gitState.prUrl} target="_blank" rel="noreferrer" className="break-all text-link underline-offset-4 hover:underline">
                {gitState.prUrl.replace(/^https:\/\/(www\.)?/, '')}
              </a>
            ) : (
              muted('none yet')
            ),
          },
        ];
  const checked = gitState ? formatAgo(new Date(gitState.checkedAt), new Date()) : null;

  return (
    <div aria-busy={isPending || undefined} className={`flex flex-col gap-4 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <FactsList facts={facts} />
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-subtle">
        {checked ? <span suppressHydrationWarning>Checked {checked}</span> : null}
        {canRefresh ? (
          <Button size="sm" variant="ghost" isPending={isPending} onPress={() => refresh()} className="min-h-11 gap-2">
            <RefreshCw aria-hidden className="size-3.5" />
            Refresh
          </Button>
        ) : (
          <span>Start the session to re-check.</span>
        )}
      </div>
    </div>
  );
}
