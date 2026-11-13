'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import type { FormState } from '@/feedback/form-state';
import { secretStore } from '@/secret-store/secret-store';
import { assertRepoAccessible, repoAccessFailure, repoPath } from './repo-access';
import { repoSecretRef, secretKeySchema, secretValueSchema } from './secret-schemas';

const setSchema = z.object({ key: secretKeySchema, value: secretValueSchema });

/** Field errors from zod, keyed by the first path segment. Messages are ours, never the input. */
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[String(issue.path[0])] ??= []).push(issue.message);
  return fieldErrors;
}

/** Logs a failed store call by error name only: its message could carry the ref or the value. */
function storeFailure(action: string, error: unknown): FormState {
  console.error(`[repos] ${action} failed:`, error instanceof Error ? error.name : 'error');
  return { status: 'error', message: `Could not ${action}. Try again.` };
}

/**
 * Creates or replaces a repository secret (write-only: the value is never returned, logged or shown).
 * The repo must be one the GitHub App can see; the ref uses GitHub's own casing of its name.
 */
export async function setRepoSecret(repo: string, key: string, value: string): Promise<FormState> {
  await requireOwner();
  const parsed = setSchema.safeParse({ key, value });
  if (!parsed.success) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  let fullName: string;
  try {
    fullName = (await assertRepoAccessible(repo)).fullName;
  } catch (error) {
    return { status: 'error', message: repoAccessFailure(error) };
  }
  try {
    await secretStore.put('repo', repoSecretRef(fullName, parsed.data.key), parsed.data.value);
  } catch (error) {
    return storeFailure('save the secret', error);
  }
  revalidatePath(`${repoPath(fullName)}/secrets`);
  return { status: 'success', message: `Saved ${parsed.data.key}.` };
}

/** Deletes one repository secret. The UI asks for confirmation first. */
export async function deleteRepoSecret(repo: string, key: string): Promise<FormState> {
  await requireOwner();
  const parsed = secretKeySchema.safeParse(key);
  if (!parsed.success) return { status: 'error', message: 'That is not a secret name.' };
  let fullName: string;
  try {
    fullName = (await assertRepoAccessible(repo)).fullName;
  } catch (error) {
    return { status: 'error', message: repoAccessFailure(error) };
  }
  try {
    await secretStore.remove('repo', repoSecretRef(fullName, parsed.data));
  } catch (error) {
    return storeFailure('delete the secret', error);
  }
  revalidatePath(`${repoPath(fullName)}/secrets`);
  return { status: 'success', message: `Deleted ${parsed.data}.` };
}
