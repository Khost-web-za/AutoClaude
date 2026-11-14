'use client';

import { useState } from 'react';
import { useLive } from '@/live/use-live';
import type { UsageViewData } from './usage-data';
import { reviveSnapshot } from './usage-snapshot-json';

type LiveUsage = Pick<UsageViewData, 'snapshot' | 'stale' | 'reason' | 'renderedAt'>;

/** The server-rendered header data, replaced whenever a `usage` event arrives. */
export function useLiveUsage(initial: UsageViewData): UsageViewData {
  const [state, setState] = useState<{ initial: UsageViewData; live: LiveUsage | null }>({ initial, live: null });
  // A router.refresh() hands down fresh server data: it replaces whatever was pushed before it.
  if (state.initial !== initial) setState({ initial, live: null });
  const live = state.initial === initial ? state.live : null;

  useLive((event) => {
    if (event.kind !== 'usage') return;
    // The event arrives as JSON, so its dates are strings.
    const snapshot = reviveSnapshot(event.usage);
    setState((current) => ({
      ...current,
      live: { snapshot, stale: event.stale, reason: event.reason, renderedAt: new Date() },
    }));
  });

  return live ? { ...initial, ...live } : initial;
}
