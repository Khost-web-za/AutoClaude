import 'server-only';
import { CircleCheck, Circle } from 'lucide-react';
import Link from 'next/link';
import { getClaudeStatus } from '@/connections/connection-summary';
import { getApp } from '@/github/app-store';
import { sharedGithubDeps } from '@/github/github-deps';
import { countInstallations } from '@/github/installations';

export type SetupState = { claude: boolean; githubApp: boolean; installed: boolean };

/** What first-run setup still needs. A check that cannot be read counts as not done. */
export async function readSetupState(): Promise<SetupState> {
  const deps = sharedGithubDeps();
  const [claude, app, installations] = await Promise.all([
    getClaudeStatus(),
    getApp(deps).catch(() => null),
    countInstallations(deps).catch(() => 0),
  ]);
  return { claude: claude?.state === 'connected', githubApp: app !== null, installed: installations > 0 };
}

export const setupComplete = (state: SetupState) => state.claude && state.githubApp && state.installed;

/**
 * First-run checklist shown instead of an empty Sessions table while Claude or GitHub is not set up
 * (spec call #17). Cloudflare is always done: this page only renders behind Access.
 */
export function SetupChecklist({ state }: { state: SetupState }) {
  const steps = [
    { label: 'Cloudflare Access', detail: 'Protecting this panel.', done: true, href: '/connections/cloudflare' },
    { label: 'Claude', detail: 'Log in once; every session uses it.', done: state.claude, href: '/connections/claude' },
    { label: 'GitHub App', detail: 'Create one, or use an existing App.', done: state.githubApp, href: '/connections/github' },
    {
      label: 'Installed on an account',
      detail: 'Pick the repositories sessions may work on.',
      done: state.installed,
      href: '/connections/github',
    },
  ];
  const next = steps.find((step) => !step.done);
  return (
    <section aria-labelledby="setup-heading" className="flex max-w-xl flex-col gap-6 py-6">
      <div className="flex flex-col gap-1">
        <h2 id="setup-heading" className="text-lg font-bold text-white">
          Finish setting up
        </h2>
        <p className="text-muted">Sessions can start once Claude and GitHub are connected.</p>
      </div>
      <ol className="flex flex-col divide-y divide-border">
        {steps.map((step) => {
          const Icon = step.done ? CircleCheck : Circle;
          return (
            <li key={step.label}>
              <Link
                href={step.href}
                className="-mx-3 flex min-h-14 items-center gap-4 rounded-xl px-3 py-3 hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Icon aria-hidden className={`size-5 shrink-0 ${step.done ? 'text-accent' : 'text-text-subtle'}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`font-semibold ${step.done ? 'text-muted' : 'text-white'}`}>{step.label}</span>
                  <span className="text-sm text-text-subtle">{step.done ? 'Done' : step.detail}</span>
                </span>
                {step === next ? <span className="text-sm font-semibold text-accent-text">Set up</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
