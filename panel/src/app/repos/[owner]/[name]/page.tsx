import { SquareTerminal } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOwner } from '@/auth/require-owner';
import { parsePageParam } from '@/db/pagination';
import { repoPath } from '@/repos/repo-access';
import { loadRepoForPage, repoNameFromParams, type RepoRouteParams } from '@/repos/repo-page';
import { listRepoSessions } from '@/repos/repo-sessions';
import { dotStatus } from '@/sessions/display-status';
import { formatAgo } from '@/time/relative-time';
import { Banner } from '@/ui/banner';
import { EmptyState } from '@/ui/empty-state';
import { PageLinks } from '@/ui/page-links';
import { StatusDot } from '@/ui/status-dot';

type Props = RepoRouteParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: RepoRouteParams): Promise<Metadata> {
  return { title: `${await repoNameFromParams(params)} sessions` };
}

export default async function RepoSessionsPage({ params, searchParams }: Props) {
  await requireOwner();
  const [loaded, query] = await Promise.all([loadRepoForPage(params), searchParams]);
  if (!loaded.ok) return <Banner tone="danger" title={loaded.message} />;
  const { repo } = loaded;
  const page = await listRepoSessions(repo.fullName, parsePageParam(query.page));
  const now = new Date();

  if (page.total === 0) {
    return (
      <EmptyState
        icon={SquareTerminal}
        title="No sessions yet"
        description={`Sessions started on ${repo.fullName} show up here.`}
        action={
          <Link
            href={`/sessions/new?repo=${encodeURIComponent(repo.fullName)}`}
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            Start a session on this repository
          </Link>
        }
      />
    );
  }
  return (
    <>
      <ul className="flex max-w-4xl flex-col divide-y divide-border">
        {page.items.map((session) => (
          <li key={session.id}>
            <Link
              href={`/sessions/${session.id}`}
              className="-mx-3 flex flex-col gap-2 rounded-xl px-3 py-4 hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="w-36 shrink-0">
                <StatusDot status={dotStatus(session.status)} showLabel />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-white">{session.startingTask ?? 'No starting task'}</span>
                <span className="truncate font-mono text-xs text-text-subtle">
                  {session.workBranch} ← {session.baseBranch}
                </span>
              </span>
              <span className="text-xs text-text-subtle">{formatAgo(session.createdAt, now)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <PageLinks page={page.page} pageCount={page.pageCount} hrefFor={(n) => `${repoPath(repo.fullName)}?page=${n}`} />
    </>
  );
}
