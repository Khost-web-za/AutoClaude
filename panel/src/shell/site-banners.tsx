import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { accessSelfCheck } from '@/connections/access-status';
import { getClaudeStatus } from '@/connections/connection-summary';
import { hasSysbox } from '@/docker/sysbox-check';
import { getPanelEnv } from '@/env/panel-env';
import { Banner } from '@/ui/banner';

const VPS_SETUP_DOC = 'https://github.com/Khost-web-za/AutoClaude/blob/main/docs/vps-setup.md';
const LINK = 'inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline';

let sysboxFailureLogged = false;

/**
 * False only when Docker answered and has no sysbox-runc (R14). A failed docker.info() is logged once and
 * shows nothing: a daemon we cannot reach is not proof that Sysbox is missing.
 */
async function sysboxMissing(): Promise<boolean> {
  if (getPanelEnv().sessionRuntime !== 'sysbox-runc') return false;
  try {
    return !(await hasSysbox());
  } catch (error) {
    if (!sysboxFailureLogged) {
      sysboxFailureLogged = true;
      console.warn('[banners] could not check the Docker host for sysbox-runc:', error instanceof Error ? error.message : error);
    }
    return false;
  }
}

async function SiteBannersContent() {
  // Request-time only: never prerendered (the build has no env, database or Docker).
  await connection();
  const [claude, noSysbox, access] = await Promise.all([getClaudeStatus(), sysboxMissing(), accessSelfCheck()]);
  const banners = [
    claude?.state === 'missing' || claude?.state === 'expired' ? (
      <Banner
        key="claude"
        tone="danger"
        title={claude.state === 'missing' ? 'Claude is not connected. Sessions cannot start.' : 'The Claude login has expired. Sessions cannot start.'}
        action={
          <Link href="/connections/claude" className={LINK}>
            {claude.state === 'missing' ? 'Connect Claude' : 'Re-connect'}
          </Link>
        }
      />
    ) : null,
    noSysbox ? (
      <Banner
        key="sysbox"
        tone="danger"
        title="The Docker host has no sysbox-runc runtime. Sessions cannot start."
        action={
          <a href={VPS_SETUP_DOC} target="_blank" rel="noreferrer" className={LINK}>
            Setup guide
          </a>
        }
      />
    ) : null,
    access === 'open' ? (
      <Banner
        key="access"
        tone="danger"
        title="Cloudflare Access is not protecting this panel: its public URL answers without a login."
        action={
          <Link href="/connections/cloudflare" className={LINK}>
            Details
          </Link>
        }
      />
    ) : null,
  ].filter(Boolean);
  if (banners.length === 0) return null;
  return <div className="mb-6 flex flex-col gap-3">{banners}</div>;
}

/** Site-wide problems that stop the panel from working or leave it exposed. Streams in; renders nothing while loading. */
export function SiteBanners() {
  return (
    <Suspense fallback={null}>
      <SiteBannersContent />
    </Suspense>
  );
}
