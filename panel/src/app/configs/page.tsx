import { Layers, Lock, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOwner } from '@/auth/require-owner';
import { paginateArray, parsePageParam } from '@/db/pagination';
import { getPanelEnv } from '@/env/panel-env';
import { listProfiles } from '@/profiles/profile-catalog';
import { ProfileContents } from '@/profiles/profile-contents';
import { EmptyState } from '@/ui/empty-state';
import { PageHeader } from '@/ui/page-header';
import { PageLinks } from '@/ui/page-links';
import { SectionLabel } from '@/ui/section-label';

export const metadata: Metadata = { title: 'Configs' };

export default async function ConfigsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const [{ profiles, warnings }, params] = await Promise.all([listProfiles(getPanelEnv().configsDir), searchParams]);
  const page = paginateArray(profiles, parsePageParam(params.page));

  return (
    <>
      <PageHeader
        title="Configs"
        description="Profiles from the configs/ folder of the repository. Every session gets base plus the ones you pick. Edit them in git; this view is read-only."
      />
      {profiles.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No profiles found"
          description="Add a folder under configs/ with a CLAUDE.md, skills/ or agents/ and redeploy."
        />
      ) : (
        <>
          <ul className="flex max-w-4xl flex-col divide-y divide-border">
            {page.items.map((profile) => (
              <li key={profile.name}>
                <Link
                  href={`/configs/${profile.name}`}
                  className="-mx-3 flex flex-col gap-2 rounded-xl px-3 py-4 hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:gap-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="inline-flex items-center gap-2 font-semibold text-white">
                      {profile.name}
                      {profile.locked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-text-subtle">
                          <Lock aria-hidden className="size-3" />
                          always included
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-muted">{profile.description ?? 'No description'}</span>
                  </span>
                  <ProfileContents profile={profile} />
                </Link>
              </li>
            ))}
          </ul>
          <PageLinks page={page.page} pageCount={page.pageCount} hrefFor={(n) => `/configs?page=${n}`} />
        </>
      )}
      {warnings.length > 0 ? (
        <section className="mt-12 flex max-w-4xl flex-col gap-4">
          <SectionLabel>Skipped while reading configs/</SectionLabel>
          <ul className="flex flex-col gap-2 text-warning">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="font-mono text-xs break-all">{warning}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
