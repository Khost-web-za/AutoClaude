import { Bot, Lock, Sparkles, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/auth/require-owner';
import { getPanelEnv } from '@/env/panel-env';
import { PROFILE_NAME_PATTERN } from '@/profiles/profile-catalog';
import { getProfileDetail } from '@/profiles/profile-detail';
import { PageHeader } from '@/ui/page-header';
import { SectionLabel } from '@/ui/section-label';

type Params = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { name } = await params;
  return { title: PROFILE_NAME_PATTERN.test(name) ? `${name} config` : 'Config' };
}

function NameList({ title, icon: Icon, names, empty }: { title: string; icon: LucideIcon; names: string[]; empty: string }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionLabel>{title}</SectionLabel>
      {names.length === 0 ? (
        <p className="text-sm text-text-subtle">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {names.map((name) => (
            <li key={name} className="flex items-center gap-3 py-3 font-mono text-sm text-surface-foreground">
              <Icon aria-hidden className="size-4 shrink-0 text-text-subtle" />
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ConfigDetailPage({ params }: Params) {
  await requireOwner();
  const { name } = await params;
  const detail = await getProfileDetail(getPanelEnv().configsDir, name);
  if (!detail) notFound();
  const { profile, claudeMd, truncated, unreadable } = detail;

  return (
    <>
      <PageHeader
        title={profile.name}
        description={profile.description ?? undefined}
        back={{ href: '/configs', label: 'Configs' }}
        actions={
          profile.locked ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-text-subtle">
              <Lock aria-hidden className="size-4" />
              Always included in every session
            </span>
          ) : undefined
        }
      />
      <div className="grid max-w-6xl gap-12 lg:grid-cols-[1fr_18rem] lg:gap-16">
        <section className="flex min-w-0 flex-col gap-4">
          <SectionLabel>CLAUDE.md</SectionLabel>
          {unreadable ? (
            <p role="alert" className="text-sm text-warning">
              CLAUDE.md could not be read. Symlinks are never followed; check the file in the repository.
            </p>
          ) : claudeMd === null ? (
            <p className="text-sm text-text-subtle">This profile has no CLAUDE.md.</p>
          ) : (
            <>
              <pre className="max-h-[70vh] overflow-auto rounded-xl bg-surface p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-surface-foreground">
                {claudeMd}
              </pre>
              {truncated ? <p className="text-xs text-text-subtle">Showing the first 256 KB.</p> : null}
            </>
          )}
        </section>
        <div className="flex flex-col gap-10">
          <NameList title="Skills" icon={Sparkles} names={profile.skills} empty="No skills." />
          <NameList title="Agents" icon={Bot} names={profile.agents} empty="No agents." />
        </div>
      </div>
    </>
  );
}
