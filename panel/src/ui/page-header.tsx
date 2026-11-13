import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Every page's heading row: optional back link, h1 and description left, actions right. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  badge,
}: {
  title: string;
  description?: ReactNode;
  /** Shown beside the title (a session's live status). */
  badge?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-1 text-sm text-muted hover:text-white focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {back.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-2xl font-bold break-words text-white">{title}</h1>
          {badge}
        </div>
        {description ? <div className="text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
