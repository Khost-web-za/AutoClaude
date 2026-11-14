'use client';

import { Table } from '@heroui/react';
import Link from 'next/link';
import { LimitBadge } from '@/auto-resume/limit-badge';
import { StatusDot } from '@/ui/status-dot';
import { formatAge } from '@/time/relative-time';
import { dotStatus, openableRemoteUrl } from './display-status';
import { holdsRunningSlot } from './running-statuses';
import { OpenInClaudeButton } from './open-in-claude-button';
import type { SessionListRow } from './session-list';
import { WorkStateLabel } from './work-state-label';

const HEAD = 'font-mono text-[11px] font-medium tracking-[0.12em] text-text-subtle uppercase';

/** Desktop (lg+) session list: repo + task, branch, status, work, age, Open in Claude. */
export function SessionTable({ rows, now, timeZone }: { rows: readonly SessionListRow[]; now: Date; timeZone: string }) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Sessions" className="min-w-[56rem]">
          <Table.Header>
            <Table.Column isRowHeader className={HEAD}>
              Repo / task
            </Table.Column>
            <Table.Column className={HEAD}>Branch</Table.Column>
            <Table.Column className={HEAD}>Status</Table.Column>
            <Table.Column className={HEAD}>Work</Table.Column>
            <Table.Column className={HEAD}>Age</Table.Column>
            <Table.Column className={HEAD}>
              <span className="sr-only">Open in Claude</span>
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id} id={row.id}>
                <Table.Cell className="max-w-md py-3">
                  <Link
                    href={`/sessions/${row.id}`}
                    className="flex min-w-0 flex-col gap-1 rounded-lg focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="truncate font-semibold text-white hover:underline">{row.repoFullName}</span>
                    <span className="truncate text-xs text-muted">{row.startingTask ?? 'No starting task'}</span>
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <code className="font-mono text-xs text-accent-text/85">{row.workBranch}</code>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col items-start gap-1.5">
                    <StatusDot status={dotStatus(row.status)} showLabel />
                    <LimitBadge state={row.limitState} resumeAt={row.resumeAt} detail={row.limitDetail} timeZone={timeZone} />
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <WorkStateLabel gitState={row.gitState} />
                </Table.Cell>
                <Table.Cell className="text-xs text-text-subtle tabular-nums">{formatAge(row.createdAt, now)}</Table.Cell>
                <Table.Cell className="text-right">
                  {holdsRunningSlot(row.status) ? (
                    <OpenInClaudeButton url={openableRemoteUrl(row.status, row.remoteControlUrl)} variant="link" />
                  ) : null}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
