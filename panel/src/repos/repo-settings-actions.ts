'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/auth/require-owner';
import { DEFAULT_RESUME_MESSAGE } from '@/db/schema';
import type { FormState } from '@/feedback/form-state';
import { getPanelEnv } from '@/env/panel-env';
import { BASE_PROFILE, listProfiles } from '@/profiles/profile-catalog';
import { z } from 'zod';
import { optionalBranchNameSchema } from './branch-name';
import { assertRepoAccessible, repoAccessFailure, repoPath } from './repo-access';
import { saveRepoSettings } from './repo-settings-store';
import { resumeMessageSchema } from './resume-message';

const deliveryModeSchema = z.enum(['pull_request', 'push']);

/**
 * Saves the repository's default base branch (empty = GitHub's default branch), default profiles and
 * session delivery mode, and whether sessions resume themselves after a usage limit (and with what message).
 * `repo` is bound by the page; it is re-checked here like any other input.
 */
export async function updateRepoSettings(repo: string, _previous: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const branch = optionalBranchNameSchema.safeParse(formData.get('defaultBaseBranch') ?? '');
  const deliveryMode = deliveryModeSchema.safeParse(formData.get('deliveryMode'));
  const autoResume = formData.get('autoResume') === 'on';
  // With the switch off the message field is hidden, so an invalid one could never be fixed there: use the default.
  const typedMessage = resumeMessageSchema.safeParse(formData.get('resumeMessage') ?? '');
  const resumeMessage = typedMessage.success || autoResume ? typedMessage : resumeMessageSchema.safeParse(DEFAULT_RESUME_MESSAGE);
  const picked = formData.getAll('profiles').filter((value): value is string => typeof value === 'string');
  const [repoResult, catalog] = await Promise.all([
    assertRepoAccessible(repo).then(
      (summary) => ({ ok: true as const, fullName: summary.fullName }),
      (error: unknown) => ({ ok: false as const, message: repoAccessFailure(error) }),
    ),
    listProfiles(getPanelEnv().configsDir),
  ]);
  if (!repoResult.ok) return { status: 'error', message: repoResult.message };

  const known = new Set(catalog.profiles.map((profile) => profile.name));
  const unknown = picked.filter((name) => !known.has(name));
  const fieldErrors: Record<string, string[]> = {};
  if (!branch.success) fieldErrors.defaultBaseBranch = branch.error.issues.map((issue) => issue.message);
  if (unknown.length > 0) fieldErrors.profiles = ['Pick from the profiles shown; the list may have changed. Reload.'];
  if (!deliveryMode.success) fieldErrors.deliveryMode = ['Pick pull request or push.'];
  if (!resumeMessage.success) fieldErrors.resumeMessage = resumeMessage.error.issues.map((issue) => issue.message);
  if (!branch.success || !deliveryMode.success || !resumeMessage.success || unknown.length > 0) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors };
  }

  const chosen = new Set(picked);
  try {
    await saveRepoSettings(repoResult.fullName, {
      defaultBaseBranch: branch.data || null,
      // Catalog order, without base (always loaded), like the defaults a started session remembers.
      defaultProfiles: catalog.profiles
        .map((profile) => profile.name)
        .filter((name) => name !== BASE_PROFILE && chosen.has(name)),
      deliveryMode: deliveryMode.data,
      autoResume,
      resumeMessage: resumeMessage.data,
    });
  } catch (error) {
    console.error('[repos] saving repository settings failed:', error instanceof Error ? error.name : 'error');
    return { status: 'error', message: 'Could not save the settings. Try again.' };
  }
  revalidatePath(`${repoPath(repoResult.fullName)}/settings`);
  return { status: 'success', message: 'Repository settings saved.' };
}
