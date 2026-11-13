import type { ClaudeStatus } from '@/claude/claude-account';

export type ConnectionSummary = {
  /** `unknown` when the credentials could not be read. */
  claude: ClaudeStatus['state'] | 'unknown';
  /** Null when the database could not be asked. */
  installations: number | null;
};

export type ConnectionHealth = { tone: 'ok' | 'warning'; label: string; href: string };

const CLAUDE_PROBLEM: Record<Exclude<ConnectionSummary['claude'], 'connected'>, string> = {
  missing: 'Claude not connected',
  expired: 'Claude login expired',
  unknown: 'Claude status unknown',
};

/** The header pill: green only when Claude is connected and the App has at least one installation. */
export function describeConnections({ claude, installations }: ConnectionSummary): ConnectionHealth {
  const claudeOk = claude === 'connected';
  const githubOk = installations !== null && installations > 0;
  if (claudeOk && githubOk) return { tone: 'ok', label: 'Connected', href: '/connections' };
  if (!claudeOk && installations === 0 && claude === 'missing') {
    return { tone: 'warning', label: 'Claude and GitHub missing', href: '/connections/claude' };
  }
  if (!claudeOk) return { tone: 'warning', label: CLAUDE_PROBLEM[claude], href: '/connections/claude' };
  return {
    tone: 'warning',
    label: installations === null ? 'GitHub status unknown' : 'GitHub not installed',
    href: '/connections/github',
  };
}
