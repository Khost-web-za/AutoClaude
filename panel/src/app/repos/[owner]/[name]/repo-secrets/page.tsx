import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { parsePageParam } from '@/db/pagination';
import { repoPath } from '@/repos/repo-access';
import { loadRepoForPage, repoNameFromParams, type RepoRouteParams } from '@/repos/repo-page';
import { SecretForm } from '@/repos/secret-form';
import { SecretList } from '@/repos/secret-list';
import { repoSecretPrefix } from '@/repos/secret-schemas';
import { formatAgo } from '@/time/relative-time';
import { secretStore } from '@/secret-store/secret-store';
import { Banner } from '@/ui/banner';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';

// Served at /repos/:owner/:name/secrets through a rewrite in next.config.ts: no folder may be named
// `secrets` in this repository (ruling R12).

type Props = RepoRouteParams & { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: RepoRouteParams): Promise<Metadata> {
  return { title: `${await repoNameFromParams(params)} secrets` };
}

export default async function RepoSecretsPage({ params, searchParams }: Props) {
  await requireOwner();
  const [loaded, query] = await Promise.all([loadRepoForPage(params), searchParams]);
  if (!loaded.ok) return <Banner tone="danger" title={loaded.message} />;
  const { repo } = loaded;
  const prefix = repoSecretPrefix(repo.fullName);
  // Names and timestamps only: the page never selects a value.
  const page = await secretStore.listNamesPage('repo', prefix, parsePageParam(query.page));
  const now = new Date();
  const rows = page.items.map((item) => ({ name: item.ref.slice(prefix.length), updated: formatAgo(item.updatedAt, now) }));

  return (
    <div className="grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
      <section className="flex flex-col gap-4">
        <SectionLabel>Add or replace</SectionLabel>
        <p className="text-sm text-muted">
          Every new session on {repo.fullName} gets these as environment variables. Values are encrypted and
          write-only.
        </p>
        <SecretForm repo={repo.fullName} />
      </section>
      <section className="flex flex-col gap-4">
        <SectionLabel>
          Secrets <span className="tabular-nums">{page.total > 0 ? `· ${page.total}` : ''}</span>
        </SectionLabel>
        {page.total === 0 ? (
          <p className="text-sm text-muted">No secrets yet.</p>
        ) : (
          <>
            <SecretList key={page.page} repo={repo.fullName} rows={rows} />
            <PageLinks
              page={page.page}
              pageCount={page.pageCount}
              hrefFor={(n) => `${repoPath(repo.fullName)}/secrets?page=${n}`}
            />
          </>
        )}
      </section>
    </div>
  );
}
