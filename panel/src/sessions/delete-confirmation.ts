import type { SessionGitState } from '@/db/schema';

/** Unknown, unpushed or uncommitted work: deleting needs the repo name typed. Client-safe (the dialog uses it too). */
export function needsConfirmation(state: SessionGitState): boolean {
  return state.error !== undefined || state.unpushedCommits > 0 || state.uncommittedFiles > 0;
}
