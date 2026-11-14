import type { LimitState } from '@/db/schema';
import { formatHourMinute } from '@/time/clock-time';

/** The badge text for a session's limit state, or null when there is nothing to show. */
export function limitLabel(state: LimitState, resumeAt: Date | null, detail: string | null, timeZone: string): string | null {
  switch (state) {
    case 'none':
      return null;
    case 'limited':
      return resumeAt ? `Limit hit · resumes ${formatHourMinute(resumeAt, timeZone)}` : 'Limit hit';
    case 'resuming':
      return 'Resuming…';
    case 'failed':
      return detail ?? 'Resume failed';
  }
}

/** Amber while waiting or resuming, red once it gave up. Renders next to the status badge. */
export function LimitBadge({
  state,
  resumeAt,
  detail,
  timeZone,
}: {
  state: LimitState;
  resumeAt: Date | null;
  detail: string | null;
  timeZone: string;
}) {
  const label = limitLabel(state, resumeAt, detail, timeZone);
  if (!label) return null;
  const tone = state === 'failed' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning';
  return (
    <span title={detail ?? undefined} className={`inline-flex h-6 max-w-full items-center rounded-full px-2.5 text-xs font-semibold ${tone}`}>
      <span className="truncate">{label}</span>
    </span>
  );
}
