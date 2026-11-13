import { Skeleton } from '@heroui/react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { describeConnections } from '@/connections/connection-health';
import { getConnectionSummary } from '@/connections/connection-summary';

const TONE = {
  ok: { dot: 'bg-status-working', text: 'text-surface-foreground' },
  warning: { dot: 'bg-status-waiting', text: 'text-warning' },
} as const;

async function ConnectionPillContent() {
  // Request-time only: never prerendered (the build has no env, database or Docker).
  await connection();
  const health = describeConnections(await getConnectionSummary());
  const tone = TONE[health.tone];
  return (
    <Link
      href={health.href}
      aria-label={`Connections: ${health.label}`}
      title={health.label}
      className={`flex h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-surface px-3 text-xs font-semibold whitespace-nowrap hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-focus sm:h-8 ${tone.text}`}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
      {/* Phones show the dot only; the label is in the link's name and on the Connections page. */}
      <span className="hidden sm:inline">{health.label}</span>
    </Link>
  );
}

/** Header status: green "Connected" with Claude connected and the App installed, amber with what's missing. */
export function ConnectionPill() {
  return (
    <Suspense fallback={<Skeleton className="h-11 w-11 rounded-full sm:h-8 sm:w-28" />}>
      <ConnectionPillContent />
    </Suspense>
  );
}
