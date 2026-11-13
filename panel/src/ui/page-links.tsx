import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

const LINK =
  'inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-muted hover:text-white focus-visible:outline-2 focus-visible:outline-focus';

/** Previous / next links for a server-paginated list (`?page=`). Renders nothing for a single page. */
export function PageLinks({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={LINK}>
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-text-subtle tabular-nums">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={LINK}>
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
