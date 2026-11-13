'use client';

import { useState } from 'react';
import { useLive } from '@/live/use-live';
import { formatClock } from '@/time/clock-time';
import type { SessionEventRow } from './session-detail';
import { describeEvent, type EventTone } from './session-event-text';

type ListedEvent = { key: string; type: string; data: Record<string, unknown> | null; at: Date };

const TONE: Record<EventTone, string> = {
  default: 'text-surface-foreground',
  question: 'text-warning',
  problem: 'text-danger',
};

/**
 * A session's events, newest first. With `live`, events pushed for this session are prepended at once
 * (their full text arrives with the next server render); `limit` keeps the Overview at its five.
 */
export function SessionEventList({
  sessionId,
  events,
  timeZone,
  live = false,
  limit,
}: {
  sessionId: string;
  events: readonly SessionEventRow[];
  timeZone: string;
  live?: boolean;
  limit?: number;
}) {
  const [state, setState] = useState<{ source: readonly SessionEventRow[]; pushed: ListedEvent[] }>({
    source: events,
    pushed: [],
  });
  if (state.source !== events) setState({ source: events, pushed: [] });
  const pushed = state.source === events ? state.pushed : [];

  useLive((event) => {
    if (!live || event.kind !== 'session_event' || event.sessionId !== sessionId) return;
    setState((current) => ({
      ...current,
      pushed: [{ key: `live-${event.at}-${current.pushed.length}`, type: event.type, data: null, at: new Date(event.at) }, ...current.pushed],
    }));
  });

  const all: ListedEvent[] = [...pushed, ...events.map((e) => ({ key: String(e.id), type: e.type, data: e.data, at: e.at }))];
  const shown = limit ? all.slice(0, limit) : all;
  if (shown.length === 0) return <p className="text-sm text-muted">Nothing has happened yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border">
      {shown.map((event) => {
        const { text, tone } = describeEvent(event.type, event.data);
        return (
          <li key={event.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
            <time dateTime={event.at.toISOString()} className="w-32 shrink-0 font-mono text-xs text-text-subtle tabular-nums">
              {formatClock(event.at, timeZone)}
            </time>
            <span className={`min-w-0 text-sm break-words ${TONE[tone]}`}>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}
