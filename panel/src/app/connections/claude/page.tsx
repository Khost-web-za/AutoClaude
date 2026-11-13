import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOwner } from '@/auth/require-owner';
import type { ClaudeStatus } from '@/claude/claude-account';
import { ClaudeLoginStepper } from '@/connections/claude-login-stepper';
import { getClaudeStatus } from '@/connections/connection-summary';
import { formatWhen } from '@/connections/fact-format';
import { getSettings } from '@/settings/settings-store';
import { FactsList } from '@/ui/facts-list';
import { SectionLabel } from '@/ui/section-label';

export const metadata: Metadata = { title: 'Claude connection' };

const STATE = {
  connected: { label: 'Connected', dot: 'bg-status-working', text: 'text-accent-text' },
  expired: { label: 'Login expired', dot: 'bg-status-failed', text: 'text-danger' },
  missing: { label: 'Not connected', dot: 'bg-status-stopped', text: 'text-muted' },
  unknown: { label: 'Could not read the credentials volume', dot: 'bg-status-waiting', text: 'text-warning' },
} as const;

function statusFacts(status: ClaudeStatus | null, timeZone: string, now: Date) {
  const state = STATE[status?.state ?? 'unknown'];
  const muted = <span className="text-text-subtle">Not available</span>;
  return [
    {
      label: 'Status',
      value: (
        <span className={`inline-flex items-center gap-2 font-semibold ${state.text}`}>
          <span aria-hidden className={`size-2 rounded-full ${state.dot}`} />
          {state.label}
        </span>
      ),
    },
    { label: 'Account', value: status?.accountEmailMasked ?? muted },
    { label: 'Plan', value: status?.plan ? <span className="capitalize">{status.plan}</span> : muted },
    {
      label: 'Token refresh',
      value: (
        <span className="text-muted">
          automatic{status?.lastRefreshAt ? ` · last ${formatWhen(status.lastRefreshAt, now, timeZone)}` : ''}
        </span>
      ),
    },
    { label: 'Access token', value: status?.expiresAt ? `expires ${formatWhen(status.expiresAt, now, timeZone)}` : muted },
  ];
}

export default async function ClaudeConnectionPage() {
  await requireOwner();
  const [status, settings] = await Promise.all([getClaudeStatus(), getSettings()]);
  const now = new Date();
  return (
    <div className="grid max-w-6xl gap-12 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
      <ClaudeLoginStepper connected={status?.state === 'connected'} />
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-5">
          <SectionLabel>Current</SectionLabel>
          <FactsList facts={statusFacts(status, settings.timeZone, now)} />
        </section>
        <section className="flex flex-col gap-5">
          <SectionLabel>Usage display</SectionLabel>
          <FactsList
            facts={[
              { label: 'Show resets as', value: settings.usageResetDisplay === 'clock' ? 'Clock time' : 'Countdown' },
              { label: 'Warn at', value: `${settings.usageWarnPct}% · ${settings.usageDangerPct}%` },
            ]}
          />
          <p className="text-sm text-muted">
            The header&apos;s usage bars take these from{' '}
            <Link href="/settings" className="text-link underline-offset-4 hover:underline">
              Settings
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
