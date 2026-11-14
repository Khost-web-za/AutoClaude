import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { db } from '@/db/client';
import { parsePageParam } from '@/db/pagination';
import { KickoffForm } from '@/kickoffs/kickoff-form';
import { KickoffHistory } from '@/kickoffs/kickoff-history';
import { KickoffList } from '@/kickoffs/kickoff-list';
import { listHistory, listUpcoming } from '@/kickoffs/kickoff-store';
import { toKickoffView } from '@/kickoffs/kickoff-view';
import { getSettings } from '@/settings/settings-store';
import { instantToWallTime, nextWallClock } from '@/time/zoned-time';
import { PageHeader } from '@/ui/page-header';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';

export const metadata: Metadata = { title: 'Schedule' };

/** The form's default: the next time the clocks read this. */
const DEFAULT_START_TIME = '04:00';

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const params = await searchParams;
  const now = new Date();
  const [settings, upcoming, history] = await Promise.all([
    getSettings(),
    listUpcoming(db),
    listHistory(db, parsePageParam(params.page)),
  ]);
  const defaultLocal = instantToWallTime(nextWallClock(DEFAULT_START_TIME, settings.timeZone, now), settings.timeZone);

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Start the 5-hour usage window at a time you choose, so it resets when you want it to."
      />
      <div className="flex max-w-3xl flex-col gap-12">
        <KickoffForm timeZone={settings.timeZone} defaultLocal={defaultLocal} />
        <section className="flex flex-col gap-2">
          <SectionLabel>Upcoming</SectionLabel>
          <KickoffList rows={upcoming.map(toKickoffView)} timeZone={settings.timeZone} now={now} />
        </section>
        <section className="flex flex-col gap-2">
          <SectionLabel>History</SectionLabel>
          <KickoffHistory rows={history.items.map(toKickoffView)} timeZone={settings.timeZone} />
          <PageLinks page={history.page} pageCount={history.pageCount} hrefFor={(page) => `/schedule?page=${page}`} />
        </section>
      </div>
    </>
  );
}
