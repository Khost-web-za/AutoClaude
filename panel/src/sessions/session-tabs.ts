import type { SessionStatus } from '@/db/schema';
import { RUNNING_STATUSES } from './running-statuses';

/** The Sessions page tabs. Client-safe. */
export const SESSION_TABS = [
  { key: 'active', label: 'Active', statuses: RUNNING_STATUSES },
  { key: 'waiting', label: 'Waiting on me', statuses: ['waiting', 'idle'] },
  { key: 'stopped', label: 'Stopped', statuses: ['stopped', 'failed'] },
  { key: 'all', label: 'All', statuses: null },
] as const satisfies readonly { key: string; label: string; statuses: readonly SessionStatus[] | null }[];

export type SessionTabKey = (typeof SESSION_TABS)[number]['key'];
export type SessionTabCounts = Record<SessionTabKey, number>;

export const DEFAULT_SESSION_TAB: SessionTabKey = 'active';

export function parseSessionTab(value: string | string[] | undefined): SessionTabKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return SESSION_TABS.find((tab) => tab.key === raw)?.key ?? DEFAULT_SESSION_TAB;
}

/** `/?tab=…&q=…&page=…&orphans=…`, leaving out defaults. */
export function sessionsHref({
  tab,
  query,
  page,
  orphans,
}: {
  tab: SessionTabKey;
  query: string;
  page?: number;
  orphans?: number;
}): string {
  const search = new URLSearchParams();
  if (tab !== DEFAULT_SESSION_TAB) search.set('tab', tab);
  if (query) search.set('q', query);
  if (page && page > 1) search.set('page', String(page));
  if (orphans && orphans > 1) search.set('orphans', String(orphans));
  const text = search.toString();
  return text ? `/?${text}` : '/';
}
