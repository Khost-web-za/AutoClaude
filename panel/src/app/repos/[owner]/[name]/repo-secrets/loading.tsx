import { Skeleton } from '@heroui/react';
import { ListSkeleton } from '@/ui/page-skeleton';

export default function RepoSecretsLoading() {
  return (
    <div aria-busy="true" className="grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-32 rounded-lg" />
        <Skeleton className="h-11 w-full max-w-md rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}
