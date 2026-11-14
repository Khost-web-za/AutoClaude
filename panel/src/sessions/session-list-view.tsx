'use client';

import { SessionCards } from './session-cards';
import type { SessionListRow } from './session-list';
import { SessionTable } from './session-table';
import { useLiveLimitPatches, useLiveSessionPatches, withLiveLimitPatch, withLivePatch } from './use-live-sessions';

/**
 * One page of sessions with live status: a table from lg up, cards below. Status and the Open in Claude
 * link are patched from `session` events, limit state from `session_limit` events; anything that moves rows between tabs (a slot taken or freed)
 * is re-rendered by LiveRefresh.
 */
export function SessionListView({ rows, now, timeZone }: { rows: readonly SessionListRow[]; now: Date; timeZone: string }) {
  const patches = useLiveSessionPatches(rows);
  const limitPatches = useLiveLimitPatches(rows);
  const live =
    patches.size === 0 && limitPatches.size === 0
      ? rows
      : rows.map((row) => withLiveLimitPatch(withLivePatch(row, patches), limitPatches));
  return (
    <>
      <div className="hidden lg:block">
        <SessionTable rows={live} now={now} timeZone={timeZone} />
      </div>
      <div className="lg:hidden">
        <SessionCards rows={live} now={now} timeZone={timeZone} />
      </div>
    </>
  );
}
