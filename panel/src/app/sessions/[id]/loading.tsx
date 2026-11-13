import { Skeleton } from '@heroui/react';
import { FactsSkeleton, ListSkeleton } from '@/ui/page-skeleton';

/** A tab's content while it loads; the header and tabs above stay put. */
export default function SessionTabLoading() {
  return (
    <div aria-busy="true" className="grid max-w-6xl gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-32 rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <ListSkeleton rows={5} />
      </div>
      <FactsSkeleton rows={4} />
    </div>
  );
}
