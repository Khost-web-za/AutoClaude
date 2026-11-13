import { Skeleton } from '@heroui/react';

export default function SessionLogsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-64 rounded-lg" />
      <Skeleton className="h-[50vh] w-full rounded-xl" />
    </div>
  );
}
