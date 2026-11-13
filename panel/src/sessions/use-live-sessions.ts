'use client';

import { useState } from 'react';
import type { SessionStatus } from '@/db/schema';
import { useLive } from '@/live/use-live';

export type LiveSessionPatch = { status: SessionStatus; detail: string | null; remoteControlUrl?: string };
export type LiveSessionPatches = ReadonlyMap<string, LiveSessionPatch>;

const NONE: LiveSessionPatches = new Map();

/**
 * Status (and Open in Claude link) pushed by `session` live events for the sessions on screen, applied over
 * the server-rendered rows. New server data (a router.refresh or an action's revalidation) replaces the
 * patches, so they only ever bridge the gap until the server catches up. Never refreshes by itself:
 * LiveRefresh already does that for session pages.
 */
export function useLiveSessionPatches(source: unknown): LiveSessionPatches {
  const [state, setState] = useState<{ source: unknown; patches: LiveSessionPatches }>({ source, patches: NONE });
  if (state.source !== source) setState({ source, patches: NONE });
  useLive((event) => {
    if (event.kind !== 'session') return;
    setState((current) => {
      const next = new Map(current.patches);
      const before = next.get(event.sessionId);
      const url = event.remoteControlUrl ?? (event.status === 'starting' ? undefined : before?.remoteControlUrl);
      next.set(event.sessionId, {
        status: event.status,
        detail: event.detail ?? null,
        ...(url ? { remoteControlUrl: url } : {}),
      });
      return { ...current, patches: next };
    });
  });
  return state.source === source ? state.patches : NONE;
}

/** A row with its live patch applied. */
export function withLivePatch<T extends { id: string; status: SessionStatus; remoteControlUrl: string | null }>(
  row: T,
  patches: LiveSessionPatches,
): T {
  const patch = patches.get(row.id);
  if (!patch) return row;
  return {
    ...row,
    status: patch.status,
    remoteControlUrl: patch.status === 'starting' ? null : (patch.remoteControlUrl ?? row.remoteControlUrl),
  };
}
