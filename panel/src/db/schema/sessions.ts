import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sessionStatus = pgEnum('session_status', [
  'starting',
  'working',
  'waiting',
  'idle',
  'stopped',
  'failed',
]);

export type SessionStatus = (typeof sessionStatus.enumValues)[number];

export type SessionGitState = {
  unpushedCommits: number;
  uncommittedFiles: number;
  prUrl: string | null;
  checkedAt: string;
  error?: string;
};

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    repoFullName: text().notNull(),
    baseBranch: text().notNull(),
    workBranch: text().notNull(),
    defaultBranch: text().notNull(),
    startingTask: text(),
    status: sessionStatus().notNull().default('starting'),
    statusDetail: text(),
    containerId: text(),
    remoteControlUrl: text(),
    secretHash: text().notNull(),
    gitState: jsonb().$type<SessionGitState>(),
    diskBytes: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('sessions_status_idx').on(t.status),
    index('sessions_created_at_idx').on(t.createdAt.desc()),
    index('sessions_repo_full_name_created_at_idx').on(t.repoFullName, t.createdAt.desc()),
  ],
);
