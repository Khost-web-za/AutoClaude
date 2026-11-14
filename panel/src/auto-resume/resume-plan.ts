import type { UsageSnapshot } from '@/usage/usage-types';
import type { ScreenRead } from './limit-screen';

/** Minutes after `limitResetsAt`: the first try, then the two retries (5 and 15 minutes after the first). */
export const RESUME_OFFSETS_MIN = [1, 6, 16] as const;
export const RELAUNCH_OFFSET_MIN = 18;
export const GIVE_UP_OFFSET_MIN = 21;

const MINUTE_MS = 60_000;
/** Attempts before the relaunch: the three typed tries. After the relaunch (attempt 4) only failing is left. */
const TYPED_ATTEMPTS = RESUME_OFFSETS_MIN.length;

export const HOLD_DETAIL = 'Waiting: Claude is asking something';
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
  if (screen?.limited && screen.resetsAt && screen.resetsAt.getTime() > offset(now, 1).getTime()) {
    return { kind: 'rewait', resetsAt: screen.resetsAt };
  }
  const blockedUntil = usageBlockedUntil(usage, now);
  if (blockedUntil) return { kind: 'rewait', resetsAt: blockedUntil };

  if (attempts > TYPED_ATTEMPTS) return { kind: 'fail', detail: NO_RESPONSE_DETAIL };
  if (attempts === TYPED_ATTEMPTS || !claudeRunning) {
    return { kind: 'relaunch', nextAt: offset(limitResetsAt, GIVE_UP_OFFSET_MIN) };
  }

  const nextMinutes = RESUME_OFFSETS_MIN[attempts + 1] ?? RELAUNCH_OFFSET_MIN;
  const nextAt = offset(limitResetsAt, nextMinutes);
  if (screen?.blocking) return { kind: 'hold', nextAt, detail: HOLD_DETAIL };
  return { kind: 'type', nextAt };
}
