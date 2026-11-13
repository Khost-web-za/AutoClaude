import { Suspense } from 'react';
import { Skeleton } from '@heroui/react';
import { connection } from 'next/server';
import { db } from '@/db/client';
import { getPanelEnv } from '@/env/panel-env';
import { getSettings } from '@/settings/settings-store';
import { countRunningSessions } from '@/sessions/capacity';
import pkg from '../../package.json';
import { fetchHostStats, runnerTagOf } from './host-stats';
import { HostStatsLive } from './host-stats-live';

async function HostStatsFooterContent() {
  // Request-time only: never prerendered (the build has no env, database or sidecar).
  await connection();
  const [stats, running, settings] = await Promise.all([fetchHostStats(), countRunningSessions(db), getSettings()]);
  const env = getPanelEnv();
  const versions = (
    <span className="hidden whitespace-nowrap sm:inline">
      v{pkg.version} · runner {runnerTagOf(env.runnerImage)}
    </span>
  );
  return (
    <>
      <span className="whitespace-nowrap tabular-nums">
        Running <span className="text-muted">{running}</span> / {settings.maxRunning}
      </span>
      <HostStatsLive initial={stats} />
      <span className="ml-auto" />
      {versions}
    </>
  );
}

/** The footer's host capacity line. Streams in behind a skeleton. */
export function HostStatsFooter() {
  return (
    <Suspense fallback={<Skeleton className="h-4 w-80 max-w-full rounded-md" />}>
      <HostStatsFooterContent />
    </Suspense>
  );
}
