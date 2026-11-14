import { Skeleton } from '@heroui/react';
import { ListSkeleton } from '@/ui/page-skeleton';

export default function ScheduleLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-lg" />
      </div>
      <div className="mb-12 flex max-w-md flex-col gap-4">
        <Skeleton className="h-4 w-40 rounded-lg" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-48 rounded-xl" />
      </div>
      <ListSkeleton rows={4} />
    </div>
  );
}
