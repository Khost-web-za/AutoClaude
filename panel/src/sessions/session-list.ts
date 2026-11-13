import { and, desc, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { paginate, type PageResult } from '@/db/pagination';
import { sessions, type SessionGitState, type SessionStatus } from '@/db/schema';
import { SESSION_TABS, type SessionTabCounts, type SessionTabKey } from './session-tabs';

export const SESSION_QUERY_MAX = 100;

export type SessionListRow = {
  id: string;
  repoFullName: string;
  startingTask: string | null;
  workBranch: string;
  status: SessionStatus;
  gitState: SessionGitState | null;
  remoteControlUrl: string | null;
  createdAt: Date;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** `?q=`: the first value, trimmed and capped. */
export function parseSessionQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().slice(0, SESSION_QUERY_MAX);
}

function searchFilter(query: string): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${escapeLike(query)}%`;
  return or(ilike(sessions.repoFullName, pattern), ilike(sessions.startingTask, pattern));
}

function statusFilter(tab: SessionTabKey): SQL | undefined {
  const statuses = SESSION_TABS.find((t) => t.key === tab)?.statuses;
  return statuses ? inArray(sessions.status, [...statuses]) : undefined;
}

/** One page of live sessions on a tab, newest first; `query` matches the repository or the starting task. */
export function listSessions(
  { tab, query, page }: { tab: SessionTabKey; query: string; page: number },
  conn: Db = sharedDb,
): Promise<PageResult<SessionListRow>> {
  return paginate(
    conn,
    () =>
      conn
        .select({
          id: sessions.id,
          repoFullName: sessions.repoFullName,
          startingTask: sessions.startingTask,
          workBranch: sessions.workBranch,
          status: sessions.status,
          gitState: sessions.gitState,
          remoteControlUrl: sessions.remoteControlUrl,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(and(isNull(sessions.deletedAt), statusFilter(tab), searchFilter(query)))
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .$dynamic(),
    { page },
  );
}

/** Every tab's count in one query (same search filter as the list). */
export async function countSessionTabs(query: string, conn: Db = sharedDb): Promise<SessionTabCounts> {
  const counted = Object.fromEntries(
    SESSION_TABS.map((tab) => [
      tab.key,
      tab.statuses
        ? sql<number>`count(*) filter (where ${inArray(sessions.status, [...tab.statuses])})`.mapWith(Number)
        : sql<number>`count(*)`.mapWith(Number),
    ]),
  ) as Record<SessionTabKey, SQL.Aliased<number> | SQL<number>>;
  const [row] = await conn
    .select(counted)
    .from(sessions)
    .where(and(isNull(sessions.deletedAt), searchFilter(query)));
  return {
    active: row?.active ?? 0,
    waiting: row?.waiting ?? 0,
    stopped: row?.stopped ?? 0,
    all: row?.all ?? 0,
  };
}
