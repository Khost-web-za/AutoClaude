import { describe, expect, it } from 'vitest';
import type { LimitState, SessionStatus } from '@/db/schema';
import { nextLimitState, nextStatus, type RunnerEvent } from '@/sessions/session-status';

const ev = (type: RunnerEvent['type'], data: Record<string, unknown> = {}): RunnerEvent => ({
  type,
  data,
  at: '2026-01-01T00:00:00.000Z',
});

type Row = [string, SessionStatus, RunnerEvent, { status: SessionStatus; detail?: string } | null];

describe('nextStatus', () => {
  const rows: Row[] = [
    ['boot_step failed', 'starting', ev('boot_step', { step: 'clone', status: 'failed', error: 'boom' }), { status: 'failed', detail: 'clone: boom' }],
    ['boot_step done', 'starting', ev('boot_step', { step: 'clone', status: 'done' }), null],
    ['boot_step started on stopped (restart)', 'stopped', ev('boot_step', { step: 'docker', status: 'started' }), { status: 'starting' }],
    ['boot_step started while working', 'working', ev('boot_step', { step: 'docker', status: 'started' }), null],
    ['remote_control_url', 'starting', ev('remote_control_url', { url: 'https://claude.ai/code/x' }), { status: 'working' }],
    ['hook SessionStart', 'starting', ev('hook', { event: 'SessionStart' }), { status: 'working' }],
    ['hook SessionStart clear while idle', 'idle', ev('hook', { event: 'SessionStart', source: 'clear' }), null],
    ['hook SessionStart resume', 'idle', ev('hook', { event: 'SessionStart', source: 'resume' }), { status: 'working' }],
    ['workspace_sync leaves the status', 'idle', ev('workspace_sync', { status: 'ok' }), null],
    ['hook UserPromptSubmit', 'idle', ev('hook', { event: 'UserPromptSubmit' }), { status: 'working' }],
    ['hook Notification', 'working', ev('hook', { event: 'Notification', message: 'Needs input' }), { status: 'waiting', detail: 'Needs input' }],
    ['hook Stop', 'working', ev('hook', { event: 'Stop' }), { status: 'idle' }],
    ['claude_exited fatal', 'working', ev('claude_exited', { code: 1, restarting: false, fatal: true }), { status: 'failed' }],
    ['claude_exited restarting', 'working', ev('claude_exited', { code: 1, restarting: true, fatal: false }), null],
    ['stopped ignores hooks', 'stopped', ev('hook', { event: 'Stop' }), null],
    ['stopped ignores url', 'stopped', ev('remote_control_url', { url: 'u' }), null],
    ['stopped ignores fatal exit', 'stopped', ev('claude_exited', { code: 1, restarting: false, fatal: true }), null],
    ['stopped ignores failed step', 'stopped', ev('boot_step', { step: 'clone', status: 'failed', error: 'x' }), null],
  ];
  it.each(rows)('%s', (_name, current, event, expected) => {
    expect(nextStatus(current, event)).toEqual(expected);
  });
});

describe('nextLimitState', () => {
  const cleared = { limitState: 'none', resumeAttempts: 0, limitResetsAt: null, resumeNextAt: null, limitDetail: null };
  const crashed = { limitState: 'failed', resumeNextAt: null, limitDetail: 'Resume failed: Claude crashed' };
  const rows: [string, LimitState, RunnerEvent, object | null][] = [
    ['prompt clears limited', 'limited', ev('hook', { event: 'UserPromptSubmit' }), cleared],
    ['prompt clears resuming', 'resuming', ev('hook', { event: 'UserPromptSubmit' }), cleared],
    ['prompt leaves none', 'none', ev('hook', { event: 'UserPromptSubmit' }), null],
    ['prompt clears failed (the user carried on by hand)', 'failed', ev('hook', { event: 'UserPromptSubmit' }), cleared],
    ['fatal exit leaves failed', 'failed', ev('claude_exited', { code: 1, restarting: false, fatal: true }), null],
    ['Stop leaves resuming', 'resuming', ev('hook', { event: 'Stop' }), null],
    ['fatal exit fails resuming', 'resuming', ev('claude_exited', { code: 1, restarting: false, fatal: true }), crashed],
    ['fatal exit fails limited', 'limited', ev('claude_exited', { code: 1, restarting: false, fatal: true }), crashed],
    ['restart leaves resuming', 'resuming', ev('claude_exited', { code: 1, restarting: true, fatal: false }), null],
    ['requested relaunch leaves resuming', 'resuming', ev('claude_exited', { code: 0, restarting: true, fatal: false, requested: true }), null],
    ['fatal exit leaves none', 'none', ev('claude_exited', { code: 1, restarting: false, fatal: true }), null],
  ];
  it.each(rows)('%s', (_name, current, event, expected) => {
    expect(nextLimitState(current, event)).toEqual(expected);
  });
});
