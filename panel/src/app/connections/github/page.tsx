import { Button, buttonVariants } from '@heroui/react';
import { Building2, ExternalLink, Plus, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { authorizeGithubAsMe } from '@/connections/github-actions';
import { GithubAppSetup } from '@/connections/github-app-setup';
import { githubCallbackNotice } from '@/connections/github-notices';
import { GithubSyncButton } from '@/connections/github-sync-button';
import { parsePageParam } from '@/db/pagination';
import { getApp } from '@/github/app-store';
import { githubWebUrl } from '@/github/github-api';
import { sharedGithubDeps } from '@/github/github-deps';
import { listInstallationsPage, type InstallationRow } from '@/github/installations';
import { githubIdentityMode } from '@/github/tokens';
import { Banner } from '@/ui/banner';
import { FactsList } from '@/ui/facts-list';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';

export const metadata: Metadata = { title: 'GitHub connection' };

const EXTERNAL =
  'inline-flex min-h-11 items-center gap-1.5 text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus';

function manageUrl(web: string, installation: InstallationRow): string {
  return installation.accountType === 'Organization'
    ? `${web}/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`
    : `${web}/settings/installations/${installation.installationId}`;
}

function IdentityRow({ mode }: { mode: 'user' | 'app' }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionLabel>Who opens pull requests</SectionLabel>
      {mode === 'user' ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
          <span aria-hidden className="size-2 rounded-full bg-status-working" />
          PRs open as you
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-warning">
            <span aria-hidden className="size-2 rounded-full bg-status-waiting" />
            PRs will be opened as the App, not you
          </p>
          <form action={authorizeGithubAsMe}>
            <Button type="submit" variant="secondary" className="min-h-11">
              Authorize as me
            </Button>
          </form>
        </div>
      )}
      <p className="text-sm text-muted">
        {mode === 'user' ? 'Because sessions use your GitHub user token, ' : 'Once you authorize, '}
        sessions are not limited to their own repository: GitHub does not let user tokens be scoped to one repo. A
        session container can reach any repository the App can access as you, until that token expires (about 8
        hours). As the App, each session only gets a token for its own repository.
      </p>
    </section>
  );
}

export default async function GithubConnectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const params = await searchParams;
  const notice = githubCallbackNotice(params);
  const deps = sharedGithubDeps();
  const app = await getApp(deps);
  const noticeBanner = notice ? (
    <div className="mb-8">
      <Banner tone={notice.tone} title={notice.title} />
    </div>
  ) : null;

  if (!app) {
    return (
      <>
        {noticeBanner}
        <GithubAppSetup />
      </>
    );
  }

  const web = githubWebUrl(deps.apiUrl);
  const [installations, mode] = await Promise.all([
    listInstallationsPage(parsePageParam(params.page), deps),
    githubIdentityMode(deps),
  ]);

  return (
    <>
      {noticeBanner}
      <div className="grid max-w-6xl gap-12 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionLabel>Installed on</SectionLabel>
            <div className="flex flex-wrap gap-3">
              <a
                href={`${web}/apps/${encodeURIComponent(app.slug)}/installations/new`}
                className={buttonVariants({ variant: 'primary', className: 'min-h-11' })}
              >
                <Plus aria-hidden className="size-4" />
                Install on an account
              </a>
              <GithubSyncButton />
            </div>
          </div>
          {installations.total === 0 ? (
            <p className="py-6 text-sm text-muted">
              Not installed anywhere yet. Install the App on your account or an organization, choosing which
              repositories sessions may use.
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border">
                {installations.items.map((installation) => {
                  const Icon = installation.accountType === 'Organization' ? Building2 : UserRound;
                  return (
                    <li key={installation.installationId} className="flex items-center gap-3 py-3">
                      <Icon aria-hidden className="size-4 shrink-0 text-text-subtle" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-white">{installation.accountLogin}</span>
                      <span className="hidden text-xs text-text-subtle sm:inline">{installation.accountType}</span>
                      <a
                        href={manageUrl(web, installation)}
                        target="_blank"
                        rel="noreferrer"
                        className={`${EXTERNAL} text-sm`}
                        aria-label={`Manage the installation on ${installation.accountLogin}`}
                      >
                        Manage
                        <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                    </li>
                  );
                })}
              </ul>
              <PageLinks
                page={installations.page}
                pageCount={installations.pageCount}
                hrefFor={(page) => `/connections/github?page=${page}`}
              />
            </>
          )}
        </section>
        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-5">
            <SectionLabel>App</SectionLabel>
            <FactsList
              facts={[
                {
                  label: 'Name',
                  value: (
                    <a href={app.htmlUrl} target="_blank" rel="noreferrer" className={EXTERNAL}>
                      {app.slug}
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  ),
                },
                { label: 'Owner', value: app.ownerLogin },
                { label: 'App ID', value: <span className="font-mono">{app.appId}</span> },
              ]}
            />
          </section>
          <IdentityRow mode={mode} />
        </div>
      </div>
    </>
  );
}
