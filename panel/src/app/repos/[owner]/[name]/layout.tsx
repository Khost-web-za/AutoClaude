import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { getPanelEnv } from '@/env/panel-env';
import { githubWebUrl } from '@/github/github-api';
import { parseRepoFullName } from '@/github/tokens';
import { repoNameFromParams, type RepoRouteParams } from '@/repos/repo-page';
import { RepoTabs } from '@/repos/repo-tabs';
import { PageHeader } from '@/ui/page-header';

/**
 * Heading and tabs stay put while a tab's data streams in. Shows only the route's own name; every tab
 * page calls requireOwner() and 404s a repository the GitHub App cannot see.
 */
export default async function RepoLayout({ children, params }: RepoRouteParams & { children: ReactNode }) {
  const fullName = await repoNameFromParams(params);
  let valid = true;
  try {
    parseRepoFullName(fullName);
  } catch {
    valid = false;
  }
  const basePath = `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`;
  return (
    <>
      <PageHeader
        title={valid ? fullName : 'Repository'}
        back={{ href: '/repos', label: 'Repositories' }}
        actions={
          valid ? (
            <a
              href={`${githubWebUrl(getPanelEnv().githubApiUrl)}/${fullName}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <ExternalLink aria-hidden className="size-4" />
              Open on GitHub
            </a>
          ) : null
        }
      />
      <div className="mb-8">
        <RepoTabs basePath={basePath} />
      </div>
      {children}
    </>
  );
}
