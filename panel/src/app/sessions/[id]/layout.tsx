import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionActionBar } from '@/sessions/session-controls';
import { SessionDetailTabs } from '@/sessions/session-detail-tabs';
import { SessionLiveProvider } from '@/sessions/session-live-context';
import { loadSessionForPage, type SessionRouteParams } from '@/sessions/session-page';
import { LiveOpenInClaude, SessionStatusBadge, SessionStatusDetail } from '@/sessions/session-status-badge';
import { formatAgo } from '@/time/relative-time';
import { PageHeader } from '@/ui/page-header';

export async function generateMetadata({ params }: SessionRouteParams): Promise<Metadata> {
  const session = await loadSessionForPage(params);
  return { title: `${session.repoFullName} · ${session.workBranch}` };
}

/** Header (repo, live status, branch off base, age, Open in Claude), tabs, and the mobile action bar. */
export default async function SessionLayout({ children, params }: SessionRouteParams & { children: ReactNode }) {
  const session = await loadSessionForPage(params);
  const changes = session.gitState && !session.gitState.error
    ? session.gitState.unpushedCommits + session.gitState.uncommittedFiles
    : null;
  return (
    <SessionLiveProvider
      session={{
        id: session.id,
        repoFullName: session.repoFullName,
        status: session.status,
        statusDetail: session.statusDetail,
        remoteControlUrl: session.remoteControlUrl,
        hasContainer: session.containerId !== null,
      }}
    >
      <PageHeader
        title={session.repoFullName}
        badge={<SessionStatusBadge />}
        back={{ href: '/', label: 'Sessions' }}
        description={
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <code className="font-mono break-all text-accent-text">{session.workBranch}</code>
            {session.workBranch !== session.baseBranch && (
              <>
                <span>off</span>
                <code className="font-mono break-all text-surface-foreground">{session.baseBranch}</code>
              </>
            )}
            <span aria-hidden>·</span>
            <span>started {formatAgo(session.createdAt, new Date())}</span>
          </p>
        }
        actions={<LiveOpenInClaude className="hidden lg:inline-flex" />}
      />
      <SessionStatusDetail />
      <div className="mb-8">
        <SessionDetailTabs sessionId={session.id} changes={changes} />
      </div>
      {children}
      <SessionActionBar />
    </SessionLiveProvider>
  );
}
