'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import { formEntries, type FormState } from '@/feedback/form-state';
import { parsePrivateKey } from '@/github/app-jwt';
import { beginManifestFlow } from '@/github/app-manifest';
import { MissingPermissionsError } from '@/github/app-permissions';
import { GithubAppNotConfiguredError, saveExistingApp } from '@/github/app-store';
import { GithubApiError } from '@/github/github-api';
import { sharedGithubDeps } from '@/github/github-deps';
import { syncInstallations } from '@/github/installations';
import type { StateCookie } from '@/github/oauth-state';
import { startUserAuthorization } from '@/github/user-auth';

const PAGE = '/connections/github';

const organizationSchema = z
  .string()
  .trim()
  .regex(/^([A-Za-z0-9][A-Za-z0-9-]{0,38})?$/, 'Not a GitHub organization name');

const existingAppSchema = z.object({
  appId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined),
    z.number({ error: 'Enter the numeric App ID' }).int().positive().max(Number.MAX_SAFE_INTEGER),
  ),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'The slug from the App URL, e.g. my-claudecloud'),
  clientId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/, 'Copy the Client ID from the App settings'),
  clientSecret: z.string().trim().min(1, 'Generate a client secret and paste it').max(200),
  privateKey: z
    .string()
    .trim()
    .max(10_000)
    .refine((value) => /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/.test(value), {
      message: 'Paste the whole .pem file, BEGIN and END lines included',
    }),
});

async function setStateCookie(cookie: StateCookie): Promise<void> {
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}

/** Why a GitHub call failed, without echoing anything GitHub or the form sent. */
function githubFailure(error: unknown, action: string): string {
  console.error(`[github] ${action} failed:`, error instanceof Error ? error.name : 'error');
  if (error instanceof GithubAppNotConfiguredError) return 'No GitHub App is configured yet.';
  if (error instanceof MissingPermissionsError) {
    return `This App cannot run sessions. It needs ${error.missing.join(', ')}. Add them in the App's settings, or use Create GitHub App instead.`;
  }
  if (error instanceof GithubApiError) return `GitHub refused the request (${error.status}).`;
  return 'GitHub could not be reached. Try again.';
}

export type ManifestFlow = { ok: true; postUrl: string; manifest: string } | { ok: false; message: string };

/**
 * "Create GitHub App": issues the single-use state cookie and returns what the browser POSTs to GitHub.
 * An empty organization creates the App on the signed-in user's account.
 */
export async function beginGithubAppCreation(organization: string): Promise<ManifestFlow> {
  const owner = await requireOwner();
  const parsed = organizationSchema.safeParse(organization);
  if (!parsed.success) return { ok: false, message: 'That is not a GitHub organization name.' };
  const flow = beginManifestFlow(
    { ownerHint: owner.email.split('@')[0] ?? 'owner', organization: parsed.data || undefined },
    sharedGithubDeps(),
  );
  await setStateCookie(flow.cookie);
  return { ok: true, postUrl: flow.postUrl, manifest: flow.manifest };
}

/** "Use an existing App": proves the id and key with GitHub, then stores them. Secrets are never echoed back. */
export async function saveExistingGithubApp(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = existingAppSchema.safeParse(formEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors };
  }
  try {
    parsePrivateKey(parsed.data.privateKey);
  } catch {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: { privateKey: ['Not a valid RSA private key'] } };
  }
  try {
    await saveExistingApp(parsed.data, sharedGithubDeps());
  } catch (error) {
    return { status: 'error', message: githubFailure(error, 'saving the existing App') };
  }
  revalidatePath('/', 'layout');
  return { status: 'success', message: 'GitHub App saved. Install it on an account next.' };
}

export type SyncResult = { ok: true; message: string } | { ok: false; message: string };

/** Mirrors the App's installations from GitHub (adds new ones, forgets removed ones). */
export async function syncGithubInstallations(): Promise<SyncResult> {
  await requireOwner();
  try {
    await syncInstallations(sharedGithubDeps());
  } catch (error) {
    return { ok: false, message: githubFailure(error, 'installation sync') };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Installations synced.' };
}

/** "Authorize as me": sets the state cookie and sends the browser to GitHub's consent screen. */
export async function authorizeGithubAsMe(): Promise<void> {
  await requireOwner();
  let url: URL;
  try {
    const flow = await startUserAuthorization(sharedGithubDeps());
    await setStateCookie(flow.cookie);
    url = flow.url;
  } catch (error) {
    githubFailure(error, 'user authorization');
    redirect(`${PAGE}?error=authorize_failed`);
  }
  redirect(url.toString());
}
