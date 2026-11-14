import { describe, expect, it } from 'vitest';
import type { ScreenRead } from '@/auto-resume/limit-screen';
import { GIVE_UP_OFFSET_MIN, planResume, RELAUNCH_OFFSET_MIN, RESUME_OFFSETS_MIN } from '@/auto-resume/resume-plan';
import type { UsageSnapshot } from '@/usage/usage-types';

const RESET = new Date('2026-11-14T15:00:00Z');
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

const screen = (overrides: Partial<ScreenRead> = {}): ScreenRead => ({
  limited: false,
  resetsAt: null,
  blocking: null,
  promptEmpty: true,
  ...overrides,
});

const usage = (fiveHourPct: number, weeklyPct: number, weeklyResetsAt: Date | null = null): UsageSnapshot => ({
  fiveHour: { pct: fiveHourPct, resetsAt: plus(RESET, 300) },
  weekly: { pct: weeklyPct, resetsAt: weeklyResetsAt },
  extra: [],
  fetchedAt: plus(RESET, 1),
});

const input = (overrides: Partial<Parameters<typeof planResume>[0]> = {}) => ({
  attempts: 0,
  limitResetsAt: RESET,
  now: plus(RESET, 1),
  screen: screen(),
  usage: usage(0, 10),
  claudeRunning: true,
  ...overrides,
});

describe('planResume', () => {
  it('pins the offsets from the spec', () => {
    expect(RESUME_OFFSETS_MIN).toEqual([1, 6, 16]);
    expect(RELAUNCH_OFFSET_MIN).toBe(18);
    expect(GIVE_UP_OFFSET_MIN).toBe(21);
  });

  it('offsets exact: type at reset+1, next at +6, +16, relaunch at +18, fail at +21', () => {
    expect(planResume(input({ attempts: 0, now: plus(RESET, 1) }))).toEqual({ kind: 'type', nextAt: plus(RESET, 6) });
    expect(planResume(input({ attempts: 1, now: plus(RESET, 6) }))).toEqual({ kind: 'type', nextAt: plus(RESET, 16) });
    expect(planResume(input({ attempts: 2, now: plus(RESET, 16) }))).toEqual({ kind: 'type', nextAt: plus(RESET, 18) });
    expect(planResume(input({ attempts: 3, now: plus(RESET, 18) }))).toEqual({ kind: 'relaunch', nextAt: plus(RESET, 21) });
    expect(planResume(input({ attempts: 4, now: plus(RESET, 21) }))).toEqual({
      kind: 'fail',
      detail: 'Resume failed: no response after relaunch',
    });
  });

  it('re-waits when the screen shows a later reset', () => {
    const later = plus(RESET, 120);
    expect(planResume(input({ screen: screen({ limited: true, resetsAt: later }) }))).toEqual({ kind: 'rewait', resetsAt: later });
  });

  it('ignores the old limit line rolled to tomorrow and types', () => {
    const rolled = plus(RESET, 24 * 60);
    expect(planResume(input({ usage: null, screen: screen({ limited: true, resetsAt: rolled }) }))).toEqual({
      kind: 'type',
      nextAt: plus(RESET, 6),
    });
  });

  it('never schedules the next step in the past', () => {
    const now = plus(RESET, 30);
    expect(planResume(input({ attempts: 1, now }))).toEqual({ kind: 'type', nextAt: plus(now, 2) });
    expect(planResume(input({ attempts: 0, now, screen: null, claudeRunning: false }))).toEqual({
      kind: 'relaunch',
      nextAt: plus(now, 2),
    });
  });

  it('holds rather than relaunching over a question', () => {
    expect(planResume(input({ attempts: 3, now: plus(RESET, 18), screen: screen({ blocking: 'question' }) }))).toEqual({
      kind: 'hold',
      nextAt: plus(RESET, 21),
      detail: 'Waiting: Claude is asking something',
    });
  });

  it('types when the screen limit resets within the minute', () => {
    const soon = plus(RESET, 1.5);
    expect(planResume(input({ screen: screen({ limited: true, resetsAt: soon }) }))).toEqual({ kind: 'type', nextAt: plus(RESET, 6) });
  });

  it('re-checks and re-waits when weekly is at 100', () => {
    const weeklyReset = new Date('2026-11-17T09:00:00Z');
    expect(planResume(input({ attempts: 2, usage: usage(0, 100, weeklyReset) }))).toEqual({
      kind: 'rewait',
      resetsAt: weeklyReset,
    });
  });

  it('ignores a full window whose reset has already passed', () => {
    const stale = { ...usage(100, 0), fiveHour: { pct: 100, resetsAt: RESET } };
    expect(planResume(input({ usage: stale }))).toEqual({ kind: 'type', nextAt: plus(RESET, 6) });
  });

  it('never types over a permission prompt', () => {
    expect(planResume(input({ screen: screen({ blocking: 'permission' }) }))).toEqual({
      kind: 'hold',
      nextAt: plus(RESET, 6),
      detail: 'Waiting: Claude is asking something',
    });
    expect(planResume(input({ attempts: 1, screen: screen({ blocking: 'question' }) }))).toEqual({
      kind: 'hold',
      nextAt: plus(RESET, 16),
      detail: 'Waiting: Claude is asking something',
    });
  });

  it('relaunches straight away when Claude is not running', () => {
    expect(planResume(input({ screen: null, claudeRunning: false }))).toEqual({ kind: 'relaunch', nextAt: plus(RESET, 21) });
  });

  it('fails once a relaunch has happened, even with Claude gone', () => {
    expect(planResume(input({ attempts: 4, screen: null, claudeRunning: false }))).toEqual({
      kind: 'fail',
      detail: 'Resume failed: no response after relaunch',
    });
  });

  it('types without usage or screen information', () => {
    expect(planResume(input({ usage: null, screen: null }))).toEqual({ kind: 'type', nextAt: plus(RESET, 6) });
  });
});
