import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';
import { db as sharedDb, type Db } from '@/db/client';
import { paginate, type PageResult } from '@/db/pagination';
import { sessionEvents, sessionProfiles, sessions, type SessionGitState, type SessionStatus } from '@/db/schema';
import { isSessionId } from './session-record';

const RECENT_EVENTS = 5;

/** A session as its pages show it. Never the secret hash. `containerId` stays on the server. */
export type SessionView = {
  id: string;
  repoFullName: string;
  baseBranch: string;
  workBranch: string;
  startingTask: string | null;
  status: SessionStatus;
  statusDetail: string | null;
  containerId: string | null;
  remoteControlUrl: string | null;
  gitState: SessionGitState | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  profiles: string[];
};

export type SessionEventRow = { id: number; type: string; data: Record<string, unknown>; at: Date };

/** The live (not deleted) session with its profiles in merge order, or null. */
export async function loadSessionView(id: string, conn: Db = sharedDb): Promise<SessionView | null> {
  if (!isSessionId(id)) return null;
  const sessionId = id.toLowerCase();
  const [[row], profiles] = await Promise.all([
    conn
      .select({
        id: sessions.id,
        repoFullName: sessions.repoFullName,
        baseBranch: sessions.baseBranch,
        workBranch: sessions.workBranch,
        startingTask: sessions.startingTask,
        status: sessions.status,
        statusDetail: sessions.statusDetail,
        containerId: sessions.containerId,
        remoteControlUrl: sessions.remoteControlUrl,
        gitState: sessions.gitState,
        createdAt: sessions.createdAt,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt))),
    conn
      .select({ profile: sessionProfiles.profile })
      .from(sessionProfiles)
      .where(eq(sessionProfiles.sessionId, sessionId))
      .orderBy(asc(sessionProfiles.position)),
  ]);
  return row ? { ...row, profiles: profiles.map((p) => p.profile) } : null;
}

/** The session for this request: the layout and the tab page share one read. */
export const getSessionView = cache((id: string) => loadSessionView(id));

const eventColumns = { id: sessionEvents.id, type: sessionEvents.type, data: sessionEvents.data, at: sessionEvents.at };

/** The latest five events (Overview). */
export function listRecentEvents(sessionId: string, conn: Db = sharedDb): Promise<SessionEventRow[]> {
  return conn
    .select(eventColumns)
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(desc(sessionEvents.id))
    .limit(RECENT_EVENTS);
}

/** The full timeline, newest first, 20 per page (Activity). Uses the (session_id, id desc) index. */
export function listSessionEvents(sessionId: string, page: number, conn: Db = sharedDb): Promise<PageResult<SessionEventRow>> {
  return paginate(
    conn,
    () =>
      conn
        .select(eventColumns)
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(desc(sessionEvents.id))
        .$dynamic(),
    { page },
  );
}
