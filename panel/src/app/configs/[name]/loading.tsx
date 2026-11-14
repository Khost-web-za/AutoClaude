import { Skeleton } from '@heroui/react';

export default function ConfigDetailLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-4 w-20 rounded-lg" />
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-lg" />
      </div>
      <div className="grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16">
        <Skeleton className="h-80 rounded-xl" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3 w-16 rounded-lg" />
          <Skeleton className="h-4 w-40 rounded-lg" />
          <Skeleton className="h-4 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
