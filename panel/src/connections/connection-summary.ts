import 'server-only';
import { cache } from 'react';
import { claudeStatus, type ClaudeStatus } from '@/claude/claude-account';
import { sharedGithubDeps } from '@/github/github-deps';
import { countInstallations } from '@/github/installations';
import type { ConnectionSummary } from './connection-health';

/** Claude's status for this request (pill, banner and Claude tab share one read). Null when it cannot be read. */
export const getClaudeStatus = cache(async (): Promise<ClaudeStatus | null> => {
  try {
    return await claudeStatus();
  } catch (error) {
    console.error('[connections] could not read the Claude status:', error instanceof Error ? error.message : error);
    return null;
  }
});

/** What the header pill needs: is Claude connected, and is the GitHub App installed anywhere. */
export const getConnectionSummary = cache(async (): Promise<ConnectionSummary> => {
  const [claude, installations] = await Promise.all([
    getClaudeStatus(),
    countInstallations(sharedGithubDeps()).catch((error: unknown) => {
      console.error('[connections] could not count installations:', error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  return { claude: claude?.state ?? 'unknown', installations };
});
