import { Button } from '@heroui/react';
import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { authorizeGithubAsMe } from '@/connections/github-actions';
import { db } from '@/db/client';
import { githubIdentityMode } from '@/github/tokens';
import { fetchHostStats } from '@/host/host-stats';
import { getPanelEnv } from '@/env/panel-env';
import { listProfiles } from '@/profiles/profile-catalog';
import { assertRepoAccessible } from '@/repos/repo-access';
import { readRepoSettings } from '@/repos/repo-settings-store';
import { countRunningSessions } from '@/sessions/capacity';
import { NewSessionForm, type NewSessionPreset } from '@/sessions/new-session-form';
import { readSetupState, SetupChecklist } from '@/sessions/setup-checklist';
import { getSettings } from '@/settings/settings-store';
import { Banner } from '@/ui/banner';
import { PageHeader } from '@/ui/page-header';

export const metadata: Metadata = { title: 'New session' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const GB = 1024 ** 3;

/** `?repo=Owner/Name` (from a repository page) pre-picks the repository with its remembered defaults. */
async function loadPreset(value: string | string[] | undefined): Promise<NewSessionPreset> {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  try {
    const repo = await assertRepoAccessible(raw);
    const settings = await readRepoSettings(repo.fullName);
    return {
      repo: repo.fullName,
      baseBranch: settings.defaultBaseBranch ?? repo.defaultBranch,
      profiles: settings.defaultProfiles,
    };
  } catch {
    return null;
  }
}

/** "2 of 3 session slots free · 58 GB disk free". Informational: Start re-checks both on the server. */
async function capacityLine(): Promise<{ text: string; full: boolean }> {
  const [running, settings, stats] = await Promise.all([countRunningSessions(db), getSettings(), fetchHostStats()]);
  const free = Math.max(0, settings.maxRunning - running);
  const disk = stats ? `${Math.round(stats.disk.freeBytes / GB)} GB disk free` : 'disk space unknown';
  return { text: `${free} of ${settings.maxRunning} session slots free · ${disk}`, full: free === 0 };
}

export default async function NewSessionPage({ searchParams }: Props) {
  await requireOwner();
  const params = await searchParams;
  const setup = await readSetupState();
  const header = (
    <PageHeader
      title="New session"
      description="A fresh container clones the repository, creates a working branch and starts Claude."
    />
  );
  if (!setup.githubApp || !setup.installed) {
    return (
      <>
        {header}
        <SetupChecklist state={setup} />
      </>
    );
  }

  const [catalog, preset, capacity, identity] = await Promise.all([
    listProfiles(getPanelEnv().configsDir),
    loadPreset(params.repo),
    capacityLine(),
    githubIdentityMode().catch(() => null),
  ]);

  return (
    <>
      {header}
      <div className="flex max-w-4xl flex-col gap-3 empty:hidden">
        {identity === 'app' ? (
          <Banner
            tone="warning"
            title="PRs will be opened as the App, not you."
            action={
              <form action={authorizeGithubAsMe}>
                <Button type="submit" variant="secondary" size="sm" className="min-h-11">
                  Authorize as me
                </Button>
              </form>
            }
          />
        ) : null}
        {capacity.full ? (
          <Banner tone="warning" title="Every session slot is in use. Stop a session before starting another." />
        ) : null}
      </div>
      <div className="mt-8">
        <NewSessionForm profiles={catalog.profiles} preset={preset} capacity={capacity.text} />
      </div>
    </>
  );
}
