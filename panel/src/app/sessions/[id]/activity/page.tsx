import { parsePageParam } from '@/db/pagination';
import { listSessionEvents } from '@/sessions/session-detail';
import { SessionEventList } from '@/sessions/session-event-list';
import { loadSessionForPage, type SessionRouteParams } from '@/sessions/session-page';
import { getSettings } from '@/settings/settings-store';
import { PageLinks } from '@/ui/page-links';

type Props = SessionRouteParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The full event timeline, newest first, 20 per page. New events appear live on page 1. */
export default async function SessionActivityPage({ params, searchParams }: Props) {
  const session = await loadSessionForPage(params);
  const query = await searchParams;
  const [page, settings] = await Promise.all([listSessionEvents(session.id, parsePageParam(query.page)), getSettings()]);
  return (
    <div className="max-w-4xl">
      <SessionEventList sessionId={session.id} events={page.items} timeZone={settings.timeZone} live={page.page === 1} />
      <PageLinks
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(n) => `/sessions/${session.id}/activity?page=${n}`}
      />
    </div>
  );
}
