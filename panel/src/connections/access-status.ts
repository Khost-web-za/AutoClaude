import 'server-only';
import { getPanelEnv } from '@/env/panel-env';
import { cachedAccessCheck, type AccessEnforcement } from './cloudflare-selfcheck';
import { maskAud } from './access-facts';

export type AccessSelfCheck = AccessEnforcement | 'skipped';

/** True when requireOwner() is honouring CF_ACCESS_DEV_BYPASS_EMAIL (never in production). */
export function devBypassActive(): boolean {
  const env = getPanelEnv();
  return env.nodeEnv !== 'production' && env.devBypassEmail !== null;
}

/** The self-check, skipped under the dev bypass (local dev has no Access in front, so "open" is expected). */
export function accessSelfCheck(): Promise<AccessSelfCheck> {
  if (devBypassActive()) return Promise.resolve('skipped');
  return cachedAccessCheck(getPanelEnv().publicUrl);
}

/** The non-secret Access configuration shown on the Cloudflare tab. */
export function accessConfig(): { teamDomain: string; audMasked: string } {
  const env = getPanelEnv();
  return { teamDomain: env.cfAccessTeamDomain, audMasked: maskAud(env.cfAccessAud) };
}
