import { Skeleton } from '@heroui/react';
import { ListSkeleton } from '@/ui/page-skeleton';

/** Reading git in the container takes a moment. */
export default function SessionChangesLoading() {
  return (
    <div aria-busy="true" className="flex max-w-4xl flex-col gap-12">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-28 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-40 rounded-lg" />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}
