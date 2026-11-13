import type { UsageFailureReason } from './usage-client';

const REASON_TEXT: Record<string, string> = {
  'no-credentials': 'Claude is not signed in yet.',
  expired: 'The shared Claude login has expired. Start a session to refresh it.',
  unavailable: 'The usage endpoint did not answer.',
};

export function unavailableDetail(reason: UsageFailureReason | null): string {
  if (!reason) return 'No usage data.';
  return REASON_TEXT[reason] ?? `The usage endpoint answered ${reason.replace('http-', '')}.`;
}
