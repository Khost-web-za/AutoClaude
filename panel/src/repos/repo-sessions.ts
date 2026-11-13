import { and, desc, eq, isNull } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { paginate, type PageResult } from '@/db/pagination';
import { sessions, type SessionStatus as DbSessionStatus } from '@/db/schema';

export type RepoSessionRow = {
  id: string;
  workBranch: string;
  baseBranch: string;
  startingTask: string | null;
  status: DbSessionStatus;
  createdAt: Date;
};

/** A repository's live (not deleted) sessions, newest first, one page at a time. */
export function listRepoSessions(
  repoFullName: string,
  page: number,
  conn: Db = sharedDb,
): Promise<PageResult<RepoSessionRow>> {
  return paginate(
    conn,
    () =>
      conn
        .select({
          id: sessions.id,
          workBranch: sessions.workBranch,
          baseBranch: sessions.baseBranch,
          startingTask: sessions.startingTask,
          status: sessions.status,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(and(eq(sessions.repoFullName, repoFullName), isNull(sessions.deletedAt)))
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .$dynamic(),
    { page },
  );
}
