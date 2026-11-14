'use client';

import { useState } from 'react';
import { useLive } from '@/live/use-live';
import type { UsageViewData } from './usage-data';
import type { UsageSnapshot, UsageWindow } from './usage-types';

type WireWindow = { pct: number; resetsAt: string | null };
type WireSnapshot = {
  fiveHour: WireWindow;
  weekly: WireWindow;
  extra: (WireWindow & { label: string })[];
  fetchedAt: string;
};

type LiveUsage = Pick<UsageViewData, 'snapshot' | 'stale' | 'reason' | 'renderedAt'>;

const reviveWindow = (window: WireWindow): UsageWindow => ({
  pct: window.pct,
  resetsAt: window.resetsAt ? new Date(window.resetsAt) : null,
});

/** The snapshot arrives as JSON, so its dates are strings. */
function reviveSnapshot(wire: UsageSnapshot | null): UsageSnapshot | null {
  if (!wire) return null;
  const raw = wire as unknown as WireSnapshot;
  return {
    fiveHour: reviveWindow(raw.fiveHour),
    weekly: reviveWindow(raw.weekly),
    extra: raw.extra.map((window) => ({ ...reviveWindow(window), label: window.label })),
    fetchedAt: new Date(raw.fetchedAt),
  };
}

/** The server-rendered header data, replaced whenever a `usage` event arrives. */
export function useLiveUsage(initial: UsageViewData): UsageViewData {
  const [state, setState] = useState<{ initial: UsageViewData; live: LiveUsage | null }>({ initial, live: null });
  // A router.refresh() hands down fresh server data: it replaces whatever was pushed before it.
  if (state.initial !== initial) setState({ initial, live: null });
  const live = state.initial === initial ? state.live : null;

  useLive((event) => {
    if (event.kind !== 'usage') return;
    const snapshot = reviveSnapshot(event.usage);
    setState((current) => ({
      ...current,
      live: { snapshot, stale: event.stale, reason: event.reason, renderedAt: new Date() },
    }));
  });

  return live ? { ...initial, ...live } : initial;
}
