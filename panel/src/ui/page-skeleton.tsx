import { Skeleton } from '@heroui/react';

/** A list's loading rows (hairline separated, no boxes). */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-4 py-4">
          <Skeleton className="size-2.5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-2/3 max-w-96 min-w-0 flex-1 rounded-lg" />
          <Skeleton className="hidden h-4 w-24 shrink-0 rounded-lg sm:block" />
          <Skeleton className="hidden h-4 w-16 shrink-0 rounded-lg md:block" />
        </li>
      ))}
    </ul>
  );
}

/** A list page while its data loads: heading, tabs, rows. */
export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-lg" />
      </div>
      <Skeleton className="mb-6 h-11 w-80 max-w-full rounded-full" />
      <ListSkeleton rows={rows} />
    </div>
  );
}

/** A form page while its data loads: heading, then label + field pairs in two columns. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-72 max-w-full rounded-lg" />
      </div>
      <div className="grid max-w-3xl gap-x-10 gap-y-8 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32 rounded-lg" />
            <Skeleton className="h-11 w-full max-w-64 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Label/value rows (a facts list) while they load. */
export function FactsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="grid grid-cols-[8rem_1fr] gap-x-6 gap-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="contents">
          <Skeleton className="h-4 w-20 rounded-lg" />
          <Skeleton className="h-4 w-40 max-w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
