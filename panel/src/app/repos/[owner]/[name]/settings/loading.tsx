import { Skeleton } from '@heroui/react';

export default function RepoSettingsLoading() {
  return (
    <div aria-busy="true" className="flex max-w-4xl flex-col gap-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24 rounded-lg" />
        <Skeleton className="h-11 w-full max-w-md rounded-xl" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-28 rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
