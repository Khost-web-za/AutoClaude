import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { getPanelEnv } from '@/env/panel-env';
import { listProfiles } from '@/profiles/profile-catalog';
import { loadRepoForPage, repoNameFromParams, type RepoRouteParams } from '@/repos/repo-page';
import { updateRepoSettings } from '@/repos/repo-settings-actions';
import { RepoSettingsForm } from '@/repos/repo-settings-form';
import { readRepoSettings } from '@/repos/repo-settings-store';
import { Banner } from '@/ui/banner';

export async function generateMetadata({ params }: RepoRouteParams): Promise<Metadata> {
  return { title: `${await repoNameFromParams(params)} settings` };
}

export default async function RepoSettingsPage({ params }: RepoRouteParams) {
  await requireOwner();
  const loaded = await loadRepoForPage(params);
  if (!loaded.ok) return <Banner tone="danger" title={loaded.message} />;
  const { repo } = loaded;
  const [settings, catalog] = await Promise.all([
    readRepoSettings(repo.fullName),
    listProfiles(getPanelEnv().configsDir),
  ]);
  return (
    <RepoSettingsForm
      settings={settings}
      githubDefaultBranch={repo.defaultBranch}
      profiles={catalog.profiles}
      action={updateRepoSettings.bind(null, repo.fullName)}
    />
  );
}
