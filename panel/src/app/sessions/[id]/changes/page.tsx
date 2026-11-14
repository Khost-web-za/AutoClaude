import { ExternalLink, FileDiff, GitCommitHorizontal } from 'lucide-react';
import { paginateArray, parsePageParam } from '@/db/pagination';
import { refreshWorkChanges, type WorkChanges } from '@/sessions/git-state';
import { holdsRunningSlot } from '@/sessions/running-statuses';
import { loadSessionForPage, type SessionRouteParams } from '@/sessions/session-page';
import { Banner } from '@/ui/banner';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';

type Props = SessionRouteParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** `M ` → Modified etc. (index or worktree side, whichever is set). */
function fileStatus(code: string): string {
  if (code === '??') return 'new';
  const c = code.trim()[0] ?? '';
  return { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', T: 'type changed' }[c] ?? code.trim();
}

/**
 * Uncommitted files, unpushed commits and the PR link, read live from the running workspace (and stored
 * as the session's work state). Each list pages by 20 on its own (`?files=`, `?commits=`). A stopped
 * session cannot be read: its last known counts are shown instead.
 */
export default async function SessionChangesPage({ params, searchParams }: Props) {
  const session = await loadSessionForPage(params);
  const query = await searchParams;
  const base = `/sessions/${session.id}/changes`;

  if (!holdsRunningSlot(session.status)) {
    const last = session.gitState;
    return (
      <Banner
        tone="warning"
        title={
          last && !last.error
            ? `The session is not running, so its workspace can't be read. Last check: ${last.unpushedCommits} unpushed commits, ${last.uncommittedFiles} uncommitted files.`
            : "The session is not running, so its workspace can't be read. Start it again to see its changes."
        }
      />
    );
  }

  const changes: WorkChanges = await refreshWorkChanges(session.id);
  if (changes.state.error) return <Banner tone="warning" title={`Can't read the workspace: ${changes.state.error}`} />;

  const files = paginateArray(changes.files, parsePageParam(query.files));
  const commits = paginateArray(changes.commits, parsePageParam(query.commits));
  const href = (key: 'files' | 'commits', n: number) => {
    const search = new URLSearchParams({ files: String(files.page), commits: String(commits.page) });
    search.set(key, String(n));
    return `${base}?${search.toString()}`;
  };

  return (
    <div className="flex max-w-4xl flex-col gap-12">
      {session.deliveryMode !== 'push' && (
        <section className="flex flex-col gap-4">
          <SectionLabel>Pull request</SectionLabel>
          {changes.state.prUrl ? (
            <a
              href={changes.state.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 self-start font-semibold break-all text-link underline-offset-4 hover:underline"
            >
              <ExternalLink aria-hidden className="size-4 shrink-0" />
              {changes.state.prUrl.replace(/^https:\/\/(www\.)?/, '')}
            </a>
          ) : (
            <p className="text-sm text-muted">No pull request for this branch yet.</p>
        )}
      </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionLabel>Unpushed commits · {changes.commits.length}</SectionLabel>
        {changes.commits.length === 0 ? (
          <p className="text-sm text-muted">Everything committed is pushed.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {commits.items.map((commit) => (
                <li key={commit.sha} className="flex items-start gap-4 py-3">
                  <GitCommitHorizontal aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
                  <code className="shrink-0 font-mono text-xs text-accent-text">{commit.sha}</code>
                  <span className="min-w-0 text-sm break-words text-surface-foreground">{commit.subject}</span>
                </li>
              ))}
            </ul>
            <PageLinks page={commits.page} pageCount={commits.pageCount} hrefFor={(n) => href('commits', n)} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Uncommitted files · {changes.files.length}</SectionLabel>
        {changes.files.length === 0 ? (
          <p className="text-sm text-muted">The working tree is clean.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {files.items.map((file) => (
                <li key={`${file.code}${file.path}`} className="flex items-start gap-4 py-3">
                  <FileDiff aria-hidden className="mt-0.5 size-4 shrink-0 text-text-subtle" />
                  <span className="min-w-0 flex-1 font-mono text-xs break-all text-white">{file.path}</span>
                  <span className="shrink-0 text-xs text-text-subtle">{fileStatus(file.code)}</span>
                </li>
              ))}
            </ul>
            <PageLinks page={files.page} pageCount={files.pageCount} hrefFor={(n) => href('files', n)} />
          </>
        )}
      </section>
    </div>
  );
}
