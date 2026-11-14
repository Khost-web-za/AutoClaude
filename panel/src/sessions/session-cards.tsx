import { GitBranch } from 'lucide-react';
import Link from 'next/link';
import { LimitBadge } from '@/auto-resume/limit-badge';
import { StatusDot } from '@/ui/status-dot';
import { formatAge } from '@/time/relative-time';
import { dotStatus, openableRemoteUrl } from './display-status';
import { holdsRunningSlot } from './running-statuses';
import { OpenInClaudeButton } from './open-in-claude-button';
import type { SessionListRow } from './session-list';
import { WorkStateLabel } from './work-state-label';

/**
 * Phone and tablet (< lg) session list: one hairline-separated block per session. Status leads (it is what
 * you check on a phone), the task gets two lines, and Open in Claude is a full-height tap target. The
 * whole block opens the session (stretched link); Open in Claude sits above it.
 */
export function SessionCards({ rows, now, timeZone }: { rows: readonly SessionListRow[]; now: Date; timeZone: string }) {
  return (
    <ul className="-mx-4 flex flex-col divide-y divide-border border-y border-border sm:mx-0">
      {rows.map((row) => (
        <li key={row.id} className="relative flex flex-col gap-2 px-4 py-4 active:bg-surface sm:px-0">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusDot status={dotStatus(row.status)} showLabel />
              <LimitBadge state={row.limitState} resumeAt={row.limitResetsAt} detail={row.limitDetail} timeZone={timeZone} />
            </span>
            <span className="text-xs text-text-subtle tabular-nums">{formatAge(row.createdAt, now)}</span>
          </div>
          <Link
            href={`/sessions/${row.id}`}
            className="flex min-w-0 flex-col gap-1 after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="truncate font-semibold text-white">{row.repoFullName}</span>
            <span className="line-clamp-2 text-sm text-muted">{row.startingTask ?? 'No starting task'}</span>
          </Link>
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-accent-text/85">
                <GitBranch aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{row.workBranch}</span>
              </span>
              <WorkStateLabel gitState={row.gitState} />
            </span>
            {holdsRunningSlot(row.status) ? (
              <OpenInClaudeButton url={openableRemoteUrl(row.status, row.remoteControlUrl)} variant="link" className="shrink-0" />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
