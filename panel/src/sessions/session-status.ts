import type { SessionStatus } from '@/db/schema';

export type RunnerEventType = 'boot_step' | 'remote_control_url' | 'hook' | 'workspace_sync' | 'claude_exited';

export type RunnerEvent = {
  type: RunnerEventType;
  data: Record<string, unknown>;
  at: string;
};

export type StatusChange = { status: SessionStatus; detail?: string };

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The session status machine: what a runner event does to a session, or null for "no change". */
export function nextStatus(current: SessionStatus, event: RunnerEvent): StatusChange | null {
  const { data } = event;

  if (current === 'stopped') {
    // Only a restart (the runner booting again) moves a stopped session.
    return event.type === 'boot_step' && data.status === 'started' ? { status: 'starting' } : null;
  }

  switch (event.type) {
    case 'boot_step':
      if (data.status === 'failed') {
        const step = str(data.step) ?? 'unknown';
        const error = str(data.error) ?? 'failed';
        return { status: 'failed', detail: `${step}: ${error}` };
      }
      return null;
    case 'remote_control_url':
      return { status: 'working' };
    case 'hook':
      switch (data.event) {
        case 'SessionStart':
        case 'UserPromptSubmit':
          return { status: 'working' };
        case 'Notification': {
          const message = str(data.message);
          return message === undefined ? { status: 'waiting' } : { status: 'waiting', detail: message };
        }
        case 'Stop':
          return { status: 'idle' };
        default:
          return null;
      }
    case 'workspace_sync':
      return null;
    case 'claude_exited':
      return data.fatal === true && data.restarting !== true ? { status: 'failed' } : null;
  }
}

const SENSITIVE_KEY = /token|secret|password|key/i;

/** Drops every key (at any depth) named like a credential, so event rows never hold one. */
export function redactEventData(value: Record<string, unknown>): Record<string, unknown> {
  const clean = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(clean);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([key]) => !SENSITIVE_KEY.test(key))
          .map(([key, v]) => [key, clean(v)]),
      );
    }
    return input;
  };
  return clean(value) as Record<string, unknown>;
}
