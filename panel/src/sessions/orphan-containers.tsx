import 'server-only';
import { paginateArray } from '@/db/pagination';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';
import { OrphanList } from './orphan-list';
import { listOrphans, type OrphanContainer } from './reconcile';

/** Labeled session containers with no live session, or null when Docker cannot be asked. */
export async function loadOrphans(): Promise<OrphanContainer[] | null> {
  try {
    return await listOrphans();
  } catch (error) {
    console.warn('[sessions] could not list orphan containers:', error instanceof Error ? error.name : 'error');
    return null;
  }
}

/**
 * Session containers Docker still has but the panel does not track (a deleted row, a restored database).
 * Removal is offered per container behind a confirmation, never automatic. Paginated (`?orphans=`).
 */
export function OrphanContainers({
  orphans,
  page,
  hrefFor,
}: {
  orphans: readonly OrphanContainer[];
  page: number;
  hrefFor: (page: number) => string;
}) {
  if (orphans.length === 0) return null;
  const shown = paginateArray(orphans, page);
  return (
    <section aria-labelledby="orphans-heading" className="mt-16 flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionLabel as="h2">
          <span id="orphans-heading">Orphan containers · {orphans.length}</span>
        </SectionLabel>
        <p className="text-sm text-muted">
          Session containers with no session in the panel. Nothing removes them automatically: check each one, then
          remove it here.
        </p>
      </div>
      <OrphanList orphans={shown.items} />
      <PageLinks page={shown.page} pageCount={shown.pageCount} hrefFor={hrefFor} />
    </section>
  );
}
