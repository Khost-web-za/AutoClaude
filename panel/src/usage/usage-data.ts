import type { UsageResetDisplay } from '@/db/schema';
import { getSettings } from '@/settings/settings-store';
import { getUsageResult, type UsageFailureReason } from './usage-client';
import type { UsageSnapshot } from './usage-types';

export type UsageViewSettings = {
  resetDisplay: UsageResetDisplay;
  warnPct: number;
  dangerPct: number;
  timeZone: string;
};

/** What the header needs, serialisable across the server/client boundary. */
export type UsageViewData = {
  snapshot: UsageSnapshot | null;
  /** Why there is no snapshot; null when there is one. */
  reason: UsageFailureReason | null;
  settings: UsageViewSettings;
  /** Server time the data was read, so the client's first render matches the HTML. */
  renderedAt: Date;
};

const DEFAULT_SETTINGS: UsageViewSettings = { resetDisplay: 'countdown', warnPct: 80, dangerPct: 95, timeZone: 'UTC' };

/** Falls back to the defaults (logged) so a database hiccup never takes the header down with it. */
async function readViewSettings(): Promise<UsageViewSettings> {
  try {
    const row = await getSettings();
    return {
      resetDisplay: row.usageResetDisplay,
      warnPct: row.usageWarnPct,
      dangerPct: row.usageDangerPct,
      timeZone: row.timeZone,
    };
  } catch (error) {
    console.error('[usage] could not read settings, using defaults:', error instanceof Error ? error.message : error);
    return DEFAULT_SETTINGS;
  }
}

export async function loadUsageView(): Promise<UsageViewData> {
  const [result, viewSettings] = await Promise.all([getUsageResult(), readViewSettings()]);
  return {
    snapshot: result.ok ? result.snapshot : null,
    reason: result.ok ? null : result.reason,
    settings: viewSettings,
    renderedAt: new Date(),
  };
}
