import type { UsageSnapshot } from '@/usage/usage-types';
import type { ScreenRead } from './limit-screen';

/** Minutes after `limitResetsAt`: the first try, then the two retries (5 and 15 minutes after the first). */
export const RESUME_OFFSETS_MIN = [1, 6, 16] as const;
export const RELAUNCH_OFFSET_MIN = 18;
export const GIVE_UP_OFFSET_MIN = 21;

const MINUTE_MS = 60_000;
/** Attempts before the relaunch: the three typed tries. After the relaunch only failing is left. */
const TYPED_ATTEMPTS = RESUME_OFFSETS_MIN.length;
/** What a relaunch sets the attempts to, however early it came: the next step is always the give-up. */
export const RELAUNCHED_ATTEMPTS = TYPED_ATTEMPTS + 1;
/** A step is never scheduled sooner than this, so a late ladder (downtime, early relaunch) is not burnt in a row. */
const MIN_STEP_GAP_MIN = 2;
/** A 5-hour window never resets further out; a screen reset beyond this is an old line rolled to tomorrow. */
const MAX_SCREEN_RESET_MS = 6 * 60 * MINUTE_MS;

export const HOLD_DETAIL = 'Waiting: Claude is asking something';
export const DRAFT_DETAIL = 'Waiting: the prompt has unsent text';
export const NOT_AT_PROMPT_DETAIL = 'Waiting: Claude is not at an empty prompt';
export const NO_RESPONSE_DETAIL = 'Resume failed: no response after relaunch';

export type ResumeStep =
  | { kind: 'rewait'; resetsAt: Date }
  | { kind: 'type'; nextAt: Date }
  | { kind: 'relaunch'; nextAt: Date }
  | { kind: 'hold'; nextAt: Date; detail: string }
  | { kind: 'fail'; detail: string };

export type ResumeInput = {
  /** Steps already taken (typed, held or relaunched) for this limit. */
  attempts: number;
  limitResetsAt: Date;
  now: Date;
  screen: ScreenRead | null;
  usage: UsageSnapshot | null;
  claudeRunning: boolean;
};

const offset = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MINUTE_MS);

/**
 * The reset Claude's screen shows, when it can be believed. The limit line stays on screen after its reset,
 * and `readScreen` then rolls its wall time to tomorrow; such a reset (over 6 hours out) is ignored.
 */
export function trustedScreenReset(screen: ScreenRead | null, now: Date): Date | null {
  if (!screen?.limited || !screen.resetsAt) return null;
  return screen.resetsAt.getTime() - now.getTime() <= MAX_SCREEN_RESET_MS ? screen.resetsAt : null;
}

/** The latest reset of a window (5-hour or weekly) still at 100%, or null when none blocks any more. */
export function usageBlockedUntil(usage: UsageSnapshot | null, now: Date): Date | null {
  if (!usage) return null;
  const resets = [usage.fiveHour, usage.weekly]
    .filter((window) => window.pct >= 100 && window.resetsAt && window.resetsAt.getTime() > now.getTime())
    .map((window) => window.resetsAt!.getTime());
  return resets.length ? new Date(Math.max(...resets)) : null;
}

/** What the auto-resume job does now for a session waiting out its usage limit. */
export function planResume(input: ResumeInput): ResumeStep {
  const { attempts, limitResetsAt, now, screen, usage, claudeRunning } = input;

  // Still limited (a later reset on screen, or a window such as the weekly one still full): wait again for free.
  const screenReset = trustedScreenReset(screen, now);
  if (screenReset && screenReset.getTime() > offset(now, 1).getTime()) return { kind: 'rewait', resetsAt: screenReset };
  const blockedUntil = usageBlockedUntil(usage, now);
  if (blockedUntil) return { kind: 'rewait', resetsAt: blockedUntil };

  if (attempts > TYPED_ATTEMPTS) return { kind: 'fail', detail: NO_RESPONSE_DETAIL };
  const scheduled = (minutes: number) => {
    const earliest = offset(now, MIN_STEP_GAP_MIN);
    const at = offset(limitResetsAt, minutes);
    return at.getTime() < earliest.getTime() ? earliest : at;
  };
  if (!claudeRunning) return { kind: 'relaunch', nextAt: scheduled(GIVE_UP_OFFSET_MIN) };

  const nextMinutes =
    attempts === TYPED_ATTEMPTS ? GIVE_UP_OFFSET_MIN : (RESUME_OFFSETS_MIN[attempts + 1] ?? RELAUNCH_OFFSET_MIN);
  // Never type over (or relaunch away) a question Claude is asking, or text the user has not sent.
  const waitingOn = screen?.blocking ? HOLD_DETAIL : screen?.promptDraft ? DRAFT_DETAIL : null;
  if (waitingOn) return { kind: 'hold', nextAt: scheduled(nextMinutes), detail: waitingOn };
  if (attempts === TYPED_ATTEMPTS) return { kind: 'relaunch', nextAt: scheduled(GIVE_UP_OFFSET_MIN) };
  // Only type at the limit notice or an empty prompt.
  if (!screen?.limited && !screen?.promptEmpty) {
    return { kind: 'hold', nextAt: scheduled(nextMinutes), detail: NOT_AT_PROMPT_DETAIL };
  }
  return { kind: 'type', nextAt: scheduled(nextMinutes) };
}
