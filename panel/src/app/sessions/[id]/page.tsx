import { listRecentEvents } from '@/sessions/session-detail';
import { SessionOverview } from '@/sessions/session-overview';
import { loadSessionForPage, type SessionRouteParams } from '@/sessions/session-page';
import { getSettings } from '@/settings/settings-store';

export default async function SessionOverviewPage({ params }: SessionRouteParams) {
  const session = await loadSessionForPage(params);
  const [recentEvents, settings] = await Promise.all([listRecentEvents(session.id), getSettings()]);
  return <SessionOverview session={session} recentEvents={recentEvents} timeZone={settings.timeZone} />;
}
