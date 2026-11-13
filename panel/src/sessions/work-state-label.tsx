import type { SessionGitState } from '@/db/schema';

/** The list's "Work" column: unpushed commits (amber), "All pushed", or a dash before the first check. */
export function WorkStateLabel({ gitState }: { gitState: SessionGitState | null }) {
  if (!gitState) return <span className="text-xs text-text-subtle">—</span>;
  if (gitState.error) return <span className="text-xs text-text-subtle">Unknown</span>;
  if (gitState.unpushedCommits > 0) {
    return <span className="text-xs font-semibold text-warning">{gitState.unpushedCommits} unpushed</span>;
  }
  if (gitState.uncommittedFiles > 0) {
    return <span className="text-xs font-semibold text-warning">{gitState.uncommittedFiles} uncommitted</span>;
  }
  return <span className="text-xs text-text-subtle">All pushed</span>;
}
