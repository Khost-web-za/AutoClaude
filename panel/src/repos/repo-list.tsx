import { ChevronRight, GitBranch, Globe, Lock } from 'lucide-react';
import Link from 'next/link';
import type { RepoSummary } from '@/github/repos';
import { repoPath } from './repo-access';
import { formatAgo } from '@/time/relative-time';

/** One page of repositories: name, visibility, default branch and last push. Rows link to the repo's tabs. */
export function RepoList({ repos, now }: { repos: readonly RepoSummary[]; now: Date }) {
  return (
    <ul className="flex max-w-4xl flex-col divide-y divide-border">
      {repos.map((repo) => {
        const Visibility = repo.private ? Lock : Globe;
        return (
          <li key={repo.fullName}>
            <Link
              href={repoPath(repo.fullName)}
              className="-mx-3 flex items-center gap-4 rounded-xl px-3 py-4 hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Visibility aria-label={repo.private ? 'Private' : 'Public'} className="size-4 shrink-0 text-text-subtle" />
              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
                <span className="min-w-0 flex-1 truncate font-semibold text-white">{repo.fullName}</span>
                <span className="flex items-center gap-4 text-xs text-text-subtle">
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <GitBranch aria-hidden className="size-3.5" />
                    {repo.defaultBranch}
                  </span>
                  {repo.pushedAt ? <span>pushed {formatAgo(new Date(repo.pushedAt), now)}</span> : null}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-text-subtle" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
