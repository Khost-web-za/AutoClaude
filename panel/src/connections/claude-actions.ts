'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import { cancelLogin, startLogin, submitLoginCode, validateLoginCode } from '@/claude/login-helper';

export type StartLoginResult = { ok: true; loginId: string; url: string } | { ok: false; message: string };
/**
 * `retry: true` means the helper is still waiting and the owner can paste again; `false` means the helper is
 * gone (finished, timed out, or lost on a panel restart) and only "start again" helps.
 */
export type FinishLoginResult = { ok: true } | { ok: false; retry: boolean; message: string };

const loginIdSchema = z.uuid();

/** Starts `claude auth login` in a helper container and returns the link to approve. */
export async function startClaudeLogin(): Promise<StartLoginResult> {
  await requireOwner();
  try {
    const { loginId, url } = await startLogin();
    return { ok: true, loginId, url };
  } catch (error) {
    console.error('[claude] login helper failed to start:', error instanceof Error ? error.message : error);
    return { ok: false, message: 'Could not start the login helper. Is Docker reachable and the runner image built?' };
  }
}

/** Sends the pasted code; on success the credentials are written and every page sees "connected". */
export async function finishClaudeLogin(loginId: string, code: string): Promise<FinishLoginResult> {
  await requireOwner();
  const id = loginIdSchema.safeParse(loginId);
  if (!id.success) return { ok: false, retry: false, message: 'This login has expired. Start again.' };
  // Checked here so a typo does not tear the helper down (submitLoginCode disposes it after any attempt).
  const clean = typeof code === 'string' ? validateLoginCode(code) : null;
  if (!clean) return { ok: false, retry: true, message: 'Paste the code Claude showed you.' };
  try {
    const result = await submitLoginCode(id.data, clean);
    if (!result.ok) return { ok: false, retry: false, message: result.message };
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    console.error('[claude] login failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, retry: false, message: 'The login did not finish. Start a new login.' };
  }
}

export async function cancelClaudeLogin(loginId: string): Promise<void> {
  await requireOwner();
  const parsed = loginIdSchema.safeParse(loginId);
  if (parsed.success) await cancelLogin(parsed.data);
}
