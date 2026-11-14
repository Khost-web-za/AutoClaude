import { Skeleton } from '@heroui/react';
import { FactsSkeleton } from '@/ui/page-skeleton';

export default function ConnectionsLoading() {
  return (
    <div aria-busy="true" className="grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-32 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full rounded-lg" />
        <Skeleton className="h-11 w-40 rounded-xl" />
      </div>
      <FactsSkeleton />
    </div>
  );
}
