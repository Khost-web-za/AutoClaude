export type SessionStatus = 'working' | 'waiting' | 'starting' | 'failed' | 'stopped';

const STATUS_STYLE: Record<SessionStatus, { dot: string; label: string }> = {
  working: { dot: 'bg-status-working shadow-status-working', label: 'Working' },
  waiting: { dot: 'bg-status-waiting', label: 'Waiting on me' },
  starting: { dot: 'bg-status-starting', label: 'Starting' },
  failed: { dot: 'bg-status-failed', label: 'Failed' },
  stopped: { dot: 'bg-status-stopped', label: 'Stopped' },
};

/** The coloured status dot (working glows). Pass `showLabel` to print the status beside it. */
export function StatusDot({
  status,
  showLabel = false,
}: {
  status: SessionStatus;
  showLabel?: boolean;
}) {
  const { dot, label } = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`inline-block size-2 rounded-full ${dot}`} />
      <span className={showLabel ? 'text-sm font-semibold' : 'sr-only'}>{label}</span>
    </span>
  );
}
