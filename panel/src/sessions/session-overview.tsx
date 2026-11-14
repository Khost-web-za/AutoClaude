import 'server-only';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { BASE_PROFILE } from '@/profiles/profile-names';
import { SectionLabel } from '@/ui/section-label';
import { ResourceMeters, ResourceMetersSkeleton } from './resource-meters';
import { holdsRunningSlot } from './running-statuses';
import { SessionAutoResumeSwitch, SessionControls } from './session-controls';
import type { SessionEventRow, SessionView } from './session-detail';
import { SessionEventList } from './session-event-list';
import { WorkStateFacts } from './work-state-facts';

/**
 * Overview tab: the task and recent activity on the left; work state, resources, profiles and the
 * controls on the right. Two columns from lg, one below (controls then live in the action bar).
 */
export function SessionOverview({
  session,
  recentEvents,
  timeZone,
}: {
  session: SessionView;
  recentEvents: readonly SessionEventRow[];
  timeZone: string;
}) {
  const running = holdsRunningSlot(session.status);
  return (
    <div className="grid max-w-6xl gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-12">
        <section className="flex flex-col gap-4">
          <SectionLabel>Starting task</SectionLabel>
          {session.startingTask ? (
            <p className="max-w-prose text-surface-foreground break-words whitespace-pre-wrap">{session.startingTask}</p>
          ) : (
            <p className="text-muted">No starting task. Open the session in Claude to give it one.</p>
          )}
        </section>
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>Recent activity</SectionLabel>
            <Link
              href={`/sessions/${session.id}/activity`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              All activity
            </Link>
          </div>
          <SessionEventList sessionId={session.id} events={recentEvents} timeZone={timeZone} live limit={5} />
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-12">
        <section className="flex flex-col gap-4">
          <SectionLabel>Work state</SectionLabel>
          <WorkStateFacts sessionId={session.id} initial={session.gitState} canRefresh={running} />
        </section>
        <section className="flex flex-col gap-4">
          <SectionLabel>Resources</SectionLabel>
          <Suspense fallback={<ResourceMetersSkeleton />}>
            <ResourceMeters containerId={session.containerId} running={running} />
          </Suspense>
        </section>
        <section className="flex flex-col gap-4">
          <SectionLabel>Auto-resume</SectionLabel>
          <SessionAutoResumeSwitch />
        </section>
        <section className="flex flex-col gap-4">
          <SectionLabel>Config profiles</SectionLabel>
          <ul className="flex flex-wrap gap-2">
            {session.profiles.map((profile) => (
              <li
                key={profile}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 font-mono text-xs text-surface-foreground"
              >
                {profile}
                {profile === BASE_PROFILE ? <Lock aria-label="always loaded" className="size-3 opacity-60" /> : null}
              </li>
            ))}
          </ul>
        </section>
        <section className="hidden flex-col gap-4 lg:flex">
          <SectionLabel>Controls</SectionLabel>
          <SessionControls />
        </section>
      </div>
    </div>
  );
}
