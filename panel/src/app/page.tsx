import { buttonVariants } from '@heroui/react';
import { LayoutList, Plus, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOwner } from '@/auth/require-owner';
import { parsePageParam } from '@/db/pagination';
import { loadOrphans, OrphanContainers } from '@/sessions/orphan-containers';
import { countSessionTabs, listSessions, parseSessionQuery } from '@/sessions/session-list';
import { SessionListView } from '@/sessions/session-list-view';
import { parseSessionTab, SESSION_TABS, sessionsHref } from '@/sessions/session-tabs';
import { readSetupState, SetupChecklist, setupComplete } from '@/sessions/setup-checklist';
import { getSettings } from '@/settings/settings-store';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { PageLinks } from '@/ui/page-links';
import { SegmentedTabs } from '@/ui/segmented-tabs';

export const metadata: Metadata = { title: 'Sessions' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const EMPTY_TAB = {
  active: { title: 'Nothing running', description: 'Start a session and it shows up here while it works.' },
  waiting: { title: 'Nothing is waiting on you', description: 'Sessions that ask a question or finish a turn land here.' },
  stopped: { title: 'No stopped sessions', description: 'Stopped sessions keep their workspace until you delete them.' },
  all: { title: 'No sessions yet', description: 'Each session is its own container with a fresh clone and a working branch.' },
} as const;

const newSessionLink = (
  <Link href="/sessions/new" className={buttonVariants({ variant: 'primary', className: 'min-h-11 gap-2' })}>
    <Plus aria-hidden className="size-4" />
    New session
  </Link>
);

export default async function SessionsPage({ searchParams }: Props) {
  await requireOwner();
  const params = await searchParams;
  const tab = parseSessionTab(params.tab);
  const query = parseSessionQuery(params.q);
  const [page, counts, orphans, settings] = await Promise.all([
    listSessions({ tab, query, page: parsePageParam(params.page) }),
    countSessionTabs(query),
    loadOrphans(),
    getSettings(),
  ]);
  const setup = counts.all === 0 && !query ? await readSetupState() : null;
  const now = new Date();
  const orphanPage = parsePageParam(params.orphans);
  const orphansHref = (n: number) => sessionsHref({ tab, query, page: page.page, orphans: n });

  let body;
  if (setup && !setupComplete(setup)) {
    body = <SetupChecklist state={setup} />;
  } else if (page.total === 0) {
    body = query ? (
      <EmptyState
        icon={SearchX}
        title={`No sessions match "${query}"`}
        description="Search matches the repository name or the starting task."
        action={
          <Link href={sessionsHref({ tab, query: '' })} className="font-semibold text-link underline-offset-4 hover:underline">
            Clear search
          </Link>
        }
      />
    ) : (
      <EmptyState icon={LayoutList} {...EMPTY_TAB[tab]} action={tab === 'active' || tab === 'all' ? newSessionLink : undefined} />
    );
  } else {
    body = (
      <>
        <SessionListView rows={page.items} now={now} timeZone={settings.timeZone} />
        <PageLinks page={page.page} pageCount={page.pageCount} hrefFor={(n) => sessionsHref({ tab, query, page: n })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sessions"
        description={
          query ? `Matching "${query}" in repository or task.` : 'Each one is its own container. Open one in Claude to chat with it.'
        }
        actions={newSessionLink}
      />
      {setup && !setupComplete(setup) ? null : (
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <SegmentedTabs
            label="Session status"
            items={SESSION_TABS.map((item) => ({
              key: item.key,
              label: item.label,
              href: sessionsHref({ tab: item.key, query }),
              current: item.key === tab,
              count: counts[item.key],
            }))}
          />
          {query ? (
            <Link href={sessionsHref({ tab, query: '' })} className="text-sm font-semibold text-link underline-offset-4 hover:underline">
              Clear search
            </Link>
          ) : null}
        </div>
      )}
      {body}
      {orphans ? <OrphanContainers orphans={orphans} page={orphanPage} hrefFor={orphansHref} /> : null}
    </>
  );
}
