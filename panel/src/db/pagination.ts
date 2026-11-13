import type { PgSelect } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 1_000_000;

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

/** `?page=` value to a page number: first value wins, anything that is not a positive integer is 1. */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

/**
 * Runs the query one page at a time. `buildQuery` must return a fresh dynamic select (with its own
 * order by) on every call: drizzle builders are mutable, so the count and the page each get their own
 * and run in parallel. A page past the end falls back to the last page, and the effective page is returned.
 */
export async function paginate<Q extends PgSelect>(
  db: Db | Tx,
  buildQuery: () => Q,
  { page, pageSize = DEFAULT_PAGE_SIZE }: { page: number; pageSize?: number },
): Promise<PageResult<Awaited<Q>[number]>> {
  const requested = Number.isFinite(page) ? Math.min(Math.max(Math.floor(page), 1), MAX_PAGE) : 1;
  const fetchPage = async (target: number) =>
    (await buildQuery()
      .limit(pageSize)
      .offset((target - 1) * pageSize)) as Awaited<Q>;

  const [total, firstTry] = await Promise.all([
    db.$count(buildQuery().as('paginated_source')),
    fetchPage(requested),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (requested <= pageCount) return { items: firstTry, page: requested, pageSize, total, pageCount };
  return { items: await fetchPage(pageCount), page: pageCount, pageSize, total, pageCount };
}

/** The same page shape over a list already in memory (GitHub listings, config profiles). */
export function paginateArray<T>(all: readonly T[], page: number, pageSize: number = DEFAULT_PAGE_SIZE): PageResult<T> {
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const effective = Math.min(Math.max(Number.isFinite(page) ? Math.floor(page) : 1, 1), pageCount);
  return {
    items: all.slice((effective - 1) * pageSize, effective * pageSize),
    page: effective,
    pageSize,
    total: all.length,
    pageCount,
  };
}
