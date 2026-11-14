import { and, eq, inArray, isNotNull, isNull, lte, max } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { sessionEvents, sessions, type LimitState } from '@/db/schema';
import type { LiveEvent } from '@/live/event-bus';
import { StartBlockedError } from '@/sessions/capacity';
import type { UsageResult } from '@/usage/usage-client';
import { effectiveWindow } from '@/usage/usage-format';
import type { UsageSnapshot } from '@/usage/usage-types';
import { readScreen, type ScreenRead } from './limit-screen';
import { planResume, RELAUNCHED_ATTEMPTS, trustedScreenReset, usageBlockedUntil, type ResumeStep } from './resume-plan';

const MINUTE_MS = 60_000;
const LIVE_STATUSES = ['working', 'waiting', 'idle'] as const;
const WAITING_STATES = ['limited', 'resuming'] as const;
/** With only usage to go on, a working session counts as limited once its runner has been quiet this long. */
const QUIET_MS = 2 * MINUTE_MS;
/** When neither usage nor the screen says when the limit resets. */
const UNKNOWN_RESET_WAIT_MS = 15 * MINUTE_MS;
/** A claimed step holds the row this long; a panel that dies mid-step leaves it to be retried after. */
const CLAIM_LEASE_MS = 5 * MINUTE_MS;
const CAPTURE_CONCURRENCY = 4;

export type ResumeJobDeps = {
  db: Db;
  /** The visible pane, or null when Claude's tmux session is gone; throws when the container cannot be asked. */
  capturePane: (containerId: string) => Promise<string | null>;
  typeIntoClaude: (containerId: string, text: string, opts?: { escapeFirst?: boolean }) => Promise<void>;
  requestRelaunch: (containerId: string, message: string) => Promise<void>;
  getUsage: () => Promise<UsageResult>;
  publish: (event: LiveEvent) => void;
  /** Each repository's resume message, for all the given repositories at once. */
  resumeMessagesFor: (repoFullNames: string[]) => Promise<Map<string, string>>;
  /** The zone reset times on Claude's screen are in when they name none. */
  containerTimeZone: string;
};

type PaneRead = { screen: ScreenRead | null; claudeRunning: boolean; unreadable: boolean };

type RunContext = {
  deps: ResumeJobDeps;
  now: Date;
  /** Usage once per run, fetched only when some session needs it. */
  usage: () => Promise<UsageSnapshot | null>;
  readPane: (containerId: string) => Promise<PaneRead>;
};

type LimitValues = {
  limitState: LimitState;
  limitResetsAt?: Date | null;
  resumeAttempts?: number;
  resumeNextAt: Date | null;
  limitDetail: string | null;
};

const later = (date: Date, ms: number) => new Date(date.getTime() + ms);

/** At most `max` tasks at once; a finished task hands its slot straight to the next one waiting. */
function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Notices sessions that hit the usage limit and, once it resets, brings them back: types the repo's resume
 * message (twice more if nothing happens), relaunches Claude with `--continue`, then gives up. A prompt that
 * reaches Claude clears the limit (runner API); a limit still in force shows again and is detected anew.
 */
export async function runResumeJob(deps: ResumeJobDeps, now: Date): Promise<void> {
  let usage: Promise<UsageSnapshot | null> | undefined;
  const limit = createLimiter(CAPTURE_CONCURRENCY);
  const ctx: RunContext = {
    deps,
    now,
    usage: () => (usage ??= deps.getUsage().then((result) => result.snapshot, () => null)),
    readPane: (containerId) =>
      limit(async () => {
        try {
          const pane = await deps.capturePane(containerId);
          // No `claude` tmux session: Claude is not running.
          if (pane === null) return { screen: null, claudeRunning: false, unreadable: false };
          return { screen: readScreen(pane, now, deps.containerTimeZone), claudeRunning: true, unreadable: false };
        } catch {
          // Docker could not be asked: that says nothing about Claude.
          return { screen: null, claudeRunning: false, unreadable: true };
        }
      }),
  };
  await Promise.all([detectLimits(ctx), resumeDue(ctx)]);
}

function publishLimit(deps: ResumeJobDeps, sessionId: string, values: LimitValues): void {
  deps.publish({
    kind: 'session_limit',
    sessionId,
    limitState: values.limitState,
    resumeAt: values.resumeNextAt?.toISOString() ?? null,
    detail: values.limitDetail,
  });
}

async function lastEventTimes(db: Db, sessionIds: string[]): Promise<Map<string, Date>> {
  const rows = await db
    .select({ sessionId: sessionEvents.sessionId, lastAt: max(sessionEvents.at) })
    .from(sessionEvents)
    .where(inArray(sessionEvents.sessionId, sessionIds))
    .groupBy(sessionEvents.sessionId);
  return new Map(rows.flatMap((row) => (row.lastAt ? [[row.sessionId, new Date(row.lastAt)] as const] : [])));
}

/** Marks running auto-resume sessions `limited` when their screen, or usage plus a quiet runner, says so. */
async function detectLimits(ctx: RunContext): Promise<void> {
  const { deps, now } = ctx;
  const candidates = await deps.db
    .select({ id: sessions.id, status: sessions.status, containerId: sessions.containerId })
    .from(sessions)
    .where(
      and(
        eq(sessions.autoResume, true),
        inArray(sessions.status, [...LIVE_STATUSES]),
        isNotNull(sessions.containerId),
        eq(sessions.limitState, 'none'),
        isNull(sessions.deletedAt),
      ),
    );
  if (candidates.length === 0) return;

  const [panes, lastEvents, usage] = await Promise.all([
    Promise.all(candidates.map((row) => ctx.readPane(row.containerId!))),
    lastEventTimes(
      deps.db,
      candidates.map((row) => row.id),
    ),
    ctx.usage(),
  ]);
  const fiveHourFull = usage ? effectiveWindow(usage.fiveHour, now).pct >= 100 : false;
  const usageReset = usageBlockedUntil(usage, now);

  await Promise.all(
    candidates.map(async (row, index) => {
      const screen = panes[index]?.screen ?? null;
      const lastEvent = lastEvents.get(row.id);
      const quiet = row.status === 'idle' || !lastEvent || now.getTime() - lastEvent.getTime() >= QUIET_MS;
      if (!screen?.limited && !(fiveHourFull && quiet)) return;

      const resetsAt = usageReset ?? trustedScreenReset(screen, now) ?? later(now, UNKNOWN_RESET_WAIT_MS);
      const values: LimitValues = {
        limitState: 'limited',
        limitResetsAt: resetsAt,
        resumeNextAt: later(resetsAt, MINUTE_MS),
        resumeAttempts: 0,
        limitDetail: null,
      };
      const [marked] = await deps.db
        .update(sessions)
        .set(values)
        .where(and(eq(sessions.id, row.id), eq(sessions.limitState, 'none'), eq(sessions.autoResume, true)))
        .returning({ id: sessions.id });
      if (marked) publishLimit(deps, row.id, values);
    }),
  );
}

type DueRow = {
  id: string;
  repoFullName: string;
  containerId: string | null;
  limitResetsAt: Date | null;
  resumeAttempts: number;
  resumeNextAt: Date | null;
};

/** Takes the next step for every waiting session whose step is due. */
async function resumeDue(ctx: RunContext): Promise<void> {
  const { deps, now } = ctx;
  const due = await deps.db
    .select({
      id: sessions.id,
      repoFullName: sessions.repoFullName,
      containerId: sessions.containerId,
      limitResetsAt: sessions.limitResetsAt,
      resumeAttempts: sessions.resumeAttempts,
      resumeNextAt: sessions.resumeNextAt,
    })
    .from(sessions)
    .where(
      and(
        inArray(sessions.limitState, [...WAITING_STATES]),
        lte(sessions.resumeNextAt, now),
        eq(sessions.autoResume, true),
        inArray(sessions.status, [...LIVE_STATUSES]),
        isNotNull(sessions.containerId),
        isNull(sessions.deletedAt),
      ),
    );
  if (due.length === 0) return;
  const messages = await deps.resumeMessagesFor([...new Set(due.map((row) => row.repoFullName))]);
  await Promise.all(due.map((row) => resumeOne(ctx, row, messages.get(row.repoFullName)!)));
}

async function resumeOne(ctx: RunContext, row: DueRow, message: string): Promise<void> {
  const { deps, now } = ctx;
  const containerId = row.containerId!;
  // Claim: only the run that moves resume_next_at off the value it read takes this step.
  const lease = later(now, CLAIM_LEASE_MS);
  const [claimed] = await deps.db
    .update(sessions)
    .set({ resumeNextAt: lease })
    .where(
      and(
        eq(sessions.id, row.id),
        eq(sessions.resumeNextAt, row.resumeNextAt!),
        inArray(sessions.limitState, [...WAITING_STATES]),
      ),
    )
    .returning({ id: sessions.id });
  if (!claimed) return;

  const [pane, usage] = await Promise.all([ctx.readPane(containerId), ctx.usage()]);
  const step = planResume({
    attempts: row.resumeAttempts,
    limitResetsAt: row.limitResetsAt ?? row.resumeNextAt!,
    now,
    screen: pane.screen,
    usage,
    claudeRunning: pane.claudeRunning,
    screenUnreadable: pane.unreadable,
  });
  const values = await takeStep(deps, row, containerId, step, message, pane.screen?.limitMenu ?? false);

  // Only if nothing else moved the row meanwhile: a prompt reaching Claude clears the limit (runner API).
  const [written] = await deps.db
    .update(sessions)
    .set(values)
    .where(and(eq(sessions.id, row.id), eq(sessions.resumeNextAt, lease)))
    .returning({ id: sessions.id });
  if (written) publishLimit(deps, row.id, values);
}

async function takeStep(
  deps: ResumeJobDeps,
  row: DueRow,
  containerId: string,
  step: ResumeStep,
  message: string,
  limitMenu: boolean,
): Promise<LimitValues> {
  const attempts = row.resumeAttempts + 1;
  switch (step.kind) {
    case 'rewait':
      // A new reset starts the ladder again; waiting spends no attempt.
      return {
        limitState: 'limited',
        limitResetsAt: step.resetsAt,
        resumeAttempts: 0,
        resumeNextAt: later(step.resetsAt, MINUTE_MS),
        limitDetail: null,
      };
    case 'hold':
      return { limitState: 'resuming', resumeAttempts: attempts, resumeNextAt: step.nextAt, limitDetail: step.detail };
    case 'fail':
      return { limitState: 'failed', resumeNextAt: null, limitDetail: step.detail };
    case 'type': {
      // Escape only closes the limit menu; at the prompt it would interrupt Claude.
      const detail = await failureDetail(() => deps.typeIntoClaude(containerId, message, { escapeFirst: limitMenu }));
      return { limitState: 'resuming', resumeAttempts: attempts, resumeNextAt: step.nextAt, limitDetail: detail };
    }
    case 'relaunch': {
      const detail = await failureDetail(() => deps.requestRelaunch(containerId, message));
      return { limitState: 'resuming', resumeAttempts: RELAUNCHED_ATTEMPTS, resumeNextAt: step.nextAt, limitDetail: detail };
    }
  }
}

/** Null when `send` worked; otherwise the short, fixed reason. The attempt still counts either way. */
async function failureDetail(send: () => Promise<void>): Promise<string | null> {
  try {
    await send();
    return null;
  } catch (error) {
    return error instanceof StartBlockedError ? error.message : 'Could not reach Claude in the session.';
  }
}
