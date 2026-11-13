import { Suspense } from 'react';
import { Skeleton } from '@heroui/react';
import { connection } from 'next/server';
import { UsageChip } from './usage-chip';
import { loadUsageView } from './usage-data';
import { UsageMeters } from './usage-meters';

async function UsageSlotContent() {
  // Request-time only: never prerendered (the build has no env, database or Docker).
  await connection();
  const data = await loadUsageView();
  return (
    <>
      <UsageMeters data={data} className="hidden lg:block" />
      <UsageChip data={data} className="lg:hidden" />
    </>
  );
}

/** The header's usage area: desktop bars from lg up, a chip below. Streams in behind a skeleton. */
export function UsageSlot() {
  return (
    <Suspense
      fallback={
        <>
          <Skeleton className="hidden h-9 w-72 rounded-md lg:block" />
          <Skeleton className="h-11 w-16 rounded-full lg:hidden" />
        </>
      }
    >
      <UsageSlotContent />
    </Suspense>
  );
}
