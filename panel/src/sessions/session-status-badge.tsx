'use client';

import { LimitBadge } from '@/auto-resume/limit-badge';
import { StatusDot } from '@/ui/status-dot';
import { dotStatus } from './display-status';
import { OpenInClaudeButton } from './open-in-claude-button';
import { useSessionLive } from './session-live-context';

/** The header's live status pill, with the status detail (failure reason, Claude's question) as its title. */
export function SessionStatusBadge() {
  const { status, statusDetail } = useSessionLive();
  return (
    <span
      title={statusDetail ?? undefined}
      aria-live="polite"
      className="inline-flex h-8 items-center rounded-full bg-surface px-3 align-middle text-white"
    >
      <StatusDot status={dotStatus(status)} showLabel />
    </span>
  );
}

/** The status detail under the header when there is one worth reading (failed, a question). */
export function SessionStatusDetail() {
  const { status, statusDetail } = useSessionLive();
  if (!statusDetail || (status !== 'failed' && status !== 'waiting' && status !== 'stopped')) return null;
  const tone = status === 'failed' ? 'text-danger' : status === 'waiting' ? 'text-warning' : 'text-muted';
  return <p className={`mb-6 max-w-3xl text-sm break-words ${tone}`}>{statusDetail}</p>;
}

/** Open in Claude with the live link (disabled until the runner reports one). */
export function LiveOpenInClaude({ className }: { className?: string }) {
  const { remoteControlUrl } = useSessionLive();
  return <OpenInClaudeButton url={remoteControlUrl} className={className} />;
}

/** The header's limit / resume badge, next to the status pill. */
export function SessionLimitBadge() {
  const { limitState, resumeAt, limitDetail, timeZone } = useSessionLive();
  return <LimitBadge state={limitState} resumeAt={resumeAt} detail={limitDetail} timeZone={timeZone} />;
}
