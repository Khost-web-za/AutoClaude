import { SearchField } from '@heroui/react';
import { FolderGit2, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { requireOwner } from '@/auth/require-owner';
import { parsePageParam } from '@/db/pagination';
import { sharedGithubDeps } from '@/github/github-deps';
import { countInstallations } from '@/github/installations';
import { listRepos } from '@/github/repos';
import { repoAccessFailure } from '@/repos/repo-access';
import { RepoList } from '@/repos/repo-list';
import { Banner } from '@/ui/banner';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { PageLinks } from '@/ui/page-links';

export const metadata: Metadata = { title: 'Repositories' };

const MAX_QUERY = 100;

function queryOf(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().slice(0, MAX_QUERY);
}

async function loadRepos(page: number, query: string) {
  const deps = sharedGithubDeps();
  try {
    const [installations, repos] = await Promise.all([countInstallations(deps), listRepos({ page, query }, deps)]);
    return { ok: true as const, installations, repos };
  } catch (error) {
    return { ok: false as const, message: repoAccessFailure(error) };
  }
}

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const params = await searchParams;
  const query = queryOf(params.q);
  const result = await loadRepos(parsePageParam(params.page), query);
  const hrefFor = (page: number) => {
    const search = new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) });
    return `/repos?${search.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Repositories"
        description="Every repository the GitHub App can access. Open one for its sessions, secrets and defaults."
      />
      <Form action="/repos" role="search" className="mb-8 max-w-md">
        <SearchField name="q" defaultValue={query} aria-label="Search repositories" fullWidth>
          <SearchField.Group className="min-h-11">
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search repositories" maxLength={MAX_QUERY} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </Form>
      {!result.ok ? (
        <Banner tone="danger" title={result.message} />
      ) : result.installations === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No GitHub installations yet"
          description="Install the GitHub App on your account or organization and its repositories show up here."
          action={
            <Link href="/connections/github" className="font-semibold text-link underline-offset-4 hover:underline">
              Open GitHub connection
            </Link>
          }
        />
      ) : result.repos.total === 0 ? (
        <EmptyState
          icon={query ? SearchX : FolderGit2}
          title={query ? `No repositories match "${query}"` : 'No repositories'}
          description={
            query
              ? 'Search matches any part of owner/name.'
              : 'The App is installed but has no repositories selected. Add some in the installation settings on GitHub.'
          }
        />
      ) : (
        <>
          <RepoList repos={result.repos.items} now={new Date()} />
          <PageLinks page={result.repos.page} pageCount={result.repos.pageCount} hrefFor={hrefFor} />
        </>
      )}
    </>
  );
}
