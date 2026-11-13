'use client';

import { createContext, use, useOptimistic, useTransition, type ReactNode } from 'react';
import type { SessionStatus } from '@/db/schema';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { openableRemoteUrl } from './display-status';
import { restartSessionAction, stopSessionAction } from './session-actions';
import { useLiveSessionPatches } from './use-live-sessions';

export type SessionCommand = 'stop' | 'restart' | 'delete';

export type SessionSnapshot = {
  id: string;
  repoFullName: string;
  status: SessionStatus;
  statusDetail: string | null;
  remoteControlUrl: string | null;
  hasContainer: boolean;
};

type SessionLive = SessionSnapshot & {
  /** The command in flight (its optimistic status is already showing), or null. */
  pending: SessionCommand | null;
  run: (command: Exclude<SessionCommand, 'delete'>) => void;
  /** Runs `task` with `command`'s optimistic status showing until it settles (the delete dialog). */
  track: (command: SessionCommand, task: () => Promise<void>) => void;
};

const Context = createContext<SessionLive | null>(null);

const OPTIMISTIC: Record<SessionCommand, SessionStatus> = { stop: 'stopped', restart: 'starting', delete: 'stopped' };

/**
 * One session's status for its header, controls and mobile action bar: server-rendered, patched by
 * `session` live events, and overridden optimistically while Stop or Restart runs. A refusal rolls the
 * status back (the transition ends) and toasts why; success arrives as the action's revalidated page.
 */
export function SessionLiveProvider({ session, children }: { session: SessionSnapshot; children: ReactNode }) {
  // Keyed by value: a refresh that brings the same server state keeps a newer live patch.
  const patches = useLiveSessionPatches(`${session.status}|${session.statusDetail}|${session.remoteControlUrl}`);
  const patch = patches.get(session.id);
  const liveStatus = patch?.status ?? session.status;
  const [status, setOptimisticStatus] = useOptimistic(liveStatus);
  const [pendingCommand, setPendingCommand] = useOptimistic<SessionCommand | null>(null);
  const [, startTransition] = useTransition();

  function track(command: SessionCommand, task: () => Promise<void>) {
    startTransition(async () => {
      setOptimisticStatus(OPTIMISTIC[command]);
      setPendingCommand(command);
      await task();
    });
  }

  function run(command: Exclude<SessionCommand, 'delete'>) {
    track(command, async () => {
      try {
        const result = await (command === 'stop' ? stopSessionAction(session.id) : restartSessionAction(session.id));
        if (result.ok) notifySuccess(result.message);
        else notifyError(result.message);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  const remoteControlUrl = openableRemoteUrl(status, patch?.remoteControlUrl ?? session.remoteControlUrl);
  const value: SessionLive = {
    ...session,
    status,
    statusDetail: patch ? patch.detail : session.statusDetail,
    remoteControlUrl,
    pending: pendingCommand,
    run,
    track,
  };
  return <Context value={value}>{children}</Context>;
}

export function useSessionLive(): SessionLive {
  const value = use(Context);
  if (!value) throw new Error('useSessionLive outside SessionLiveProvider');
  return value;
}
