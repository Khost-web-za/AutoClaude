import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireOwner } from '@/auth/require-owner';
import { accessConfig, accessSelfCheck, devBypassActive, type AccessSelfCheck } from '@/connections/access-status';
import { formatWhen } from '@/connections/fact-format';
import { getSettings } from '@/settings/settings-store';
import { FactsList } from '@/ui/facts-list';
import { FactsSkeleton } from '@/ui/page-skeleton';
import { SectionLabel } from '@/ui/section-label';

export const metadata: Metadata = { title: 'Cloudflare Access' };

const CHECK: Record<AccessSelfCheck, { label: string; detail: string; dot: string; text: string }> = {
  enforced: {
    label: 'Enforced',
    detail: 'A request without a Cloudflare login was stopped before it reached the panel.',
    dot: 'bg-status-working',
    text: 'text-accent-text',
  },
  open: {
    label: 'Not enforced',
    detail:
      'The public URL answered without a Cloudflare login. Add an Access application covering this hostname (every path).',
    dot: 'bg-status-failed',
    text: 'text-danger',
  },
  unknown: {
    label: 'Could not tell',
    detail: 'The public URL did not answer clearly (unreachable from the server, or an unexpected status).',
    dot: 'bg-status-waiting',
    text: 'text-warning',
  },
  skipped: {
    label: 'Skipped',
    detail: 'The local dev bypass is on, so there is no Access in front of this panel.',
    dot: 'bg-status-stopped',
    text: 'text-muted',
  },
};

async function SelfCheck() {
  const result = CHECK[await accessSelfCheck()];
  return (
    <div className="flex flex-col gap-2">
      <p className={`inline-flex items-center gap-2 text-sm font-semibold ${result.text}`}>
        <span aria-hidden className={`size-2 rounded-full ${result.dot}`} />
        {result.label}
      </p>
      <p className="text-sm text-muted">{result.detail}</p>
    </div>
  );
}

export default async function CloudflareConnectionPage() {
  const owner = await requireOwner();
  const settings = await getSettings();
  const { teamDomain, audMasked } = accessConfig();
  const bypass = devBypassActive();
  return (
    <div className="grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-16">
      <section className="flex flex-col gap-5">
        <SectionLabel>Access</SectionLabel>
        <FactsList
          facts={[
            { label: 'Team domain', value: <span className="font-mono">{teamDomain}</span> },
            { label: 'Application AUD', value: <span className="font-mono">{audMasked}</span> },
            { label: 'Signed in as', value: bypass ? `${owner.email} (dev bypass)` : owner.email },
            {
              label: 'Login expires',
              value: bypass ? <span className="text-text-subtle">Not applicable</span> : formatWhen(owner.expiresAt, new Date(), settings.timeZone),
            },
          ]}
        />
        <p className="text-sm text-muted">
          Read-only. Every request is checked against Cloudflare&apos;s signed token for this team and application, and
          only the allowed email gets in.
        </p>
      </section>
      <section className="flex flex-col gap-5">
        <SectionLabel>Self-check</SectionLabel>
        <Suspense fallback={<FactsSkeleton rows={1} />}>
          <SelfCheck />
        </Suspense>
        <p className="text-xs text-text-subtle">
          Requests this panel&apos;s public URL (<span className="font-mono">/api/health</span>) without a token. Re-checked
          every 5 minutes.
        </p>
      </section>
    </div>
  );
}
