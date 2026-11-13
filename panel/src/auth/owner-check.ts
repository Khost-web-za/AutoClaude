import { verifyAccessToken } from '@/auth/access-jwt';
import { getPanelEnv, type PanelEnv } from '@/env/panel-env';

export type Owner = { email: string; expiresAt: Date };

/** The dev bypass stays valid for a day at most and is never honoured in production. */
const DEV_BYPASS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Shared by requireOwner() and proxy.ts so both apply the same rule. Returns null (never throws)
 * on any failure, including an invalid environment: fail closed.
 */
export async function resolveOwner(
  token: string | null,
  loadEnv: () => PanelEnv = getPanelEnv,
): Promise<Owner | null> {
  try {
    const env = loadEnv();
    if (env.nodeEnv !== 'production' && env.devBypassEmail) {
      return { email: env.devBypassEmail, expiresAt: new Date(Date.now() + DEV_BYPASS_TTL_MS) };
    }
    const result = await verifyAccessToken(token, env);
    return result.ok ? { email: result.email, expiresAt: result.expiresAt } : null;
  } catch {
    return null;
  }
}
