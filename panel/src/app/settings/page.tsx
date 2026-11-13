import type { Metadata } from 'next';
import { requireOwner } from '@/auth/require-owner';
import { updateSettings } from '@/settings/settings-actions';
import { SettingsForm } from '@/settings/settings-form';
import { timeZoneOptions } from '@/settings/settings-schemas';
import { getSettings } from '@/settings/settings-store';
import { PageHeader } from '@/ui/page-header';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireOwner();
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Settings" description="Session limits and how Claude usage is shown. Applies to the whole panel." />
      <SettingsForm settings={settings} timeZones={timeZoneOptions()} action={updateSettings} />
    </>
  );
}
