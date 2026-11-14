'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import { db } from '@/db/client';
import { getSettings } from '@/settings/settings-store';
import { wallTimeToInstant } from '@/time/zoned-time';
import { kickoffInputSchema, validateRunAt } from './kickoff-schemas';
import { addKickoff, KickoffLimitError, removeKickoff, rescheduleKickoff } from './kickoff-store';
import { toKickoffView, type KickoffView } from './kickoff-view';

export type KickoffActionResult = { ok: true; kickoff?: KickoffView } | { ok: false; error: string };

const idSchema = z.string().uuid();
const GONE_MESSAGE = 'That kick-off has already run or was removed.';

/** The instant for the wall time the user typed (read in the settings zone), or the error to show. */
async function parseRunAt(runAtLocal: unknown): Promise<{ ok: true; runAt: Date } | { ok: false; error: string }> {
  const parsed = kickoffInputSchema.safeParse({ runAtLocal });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pick a date and time.' };
  const { timeZone } = await getSettings();
  const runAt = wallTimeToInstant(parsed.data.runAtLocal, timeZone);
  const error = validateRunAt(runAt, new Date());
  return error ? { ok: false, error } : { ok: true, runAt };
}

/** Schedules a window kick-off at the given wall time (`YYYY-MM-DDTHH:mm`, in the settings time zone). */
export async function addKickoffAction(runAtLocal: unknown): Promise<KickoffActionResult> {
  await requireOwner();
  const when = await parseRunAt(runAtLocal);
  if (!when.ok) return when;
  try {
    const row = await addKickoff(db, when.runAt);
    revalidatePath('/schedule');
    return { ok: true, kickoff: toKickoffView(row) };
  } catch (error) {
    if (error instanceof KickoffLimitError) return { ok: false, error: error.message };
    console.error('[schedule] adding a kick-off failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, error: 'Could not add the kick-off. Try again.' };
  }
}

/** Moves a still-scheduled kick-off to another wall time. */
export async function rescheduleKickoffAction(id: unknown, runAtLocal: unknown): Promise<KickoffActionResult> {
  await requireOwner();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: GONE_MESSAGE };
  const when = await parseRunAt(runAtLocal);
  if (!when.ok) return when;
  try {
    if (!(await rescheduleKickoff(db, parsedId.data, when.runAt))) return { ok: false, error: GONE_MESSAGE };
  } catch (error) {
    console.error('[schedule] rescheduling a kick-off failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, error: 'Could not move the kick-off. Try again.' };
  }
  revalidatePath('/schedule');
  return { ok: true };
}

/** Removes a kick-off that has not started; one that already ran stays in the history. */
export async function removeKickoffAction(id: unknown): Promise<KickoffActionResult> {
  await requireOwner();
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: GONE_MESSAGE };
  try {
    if (!(await removeKickoff(db, parsedId.data))) return { ok: false, error: GONE_MESSAGE };
  } catch (error) {
    console.error('[schedule] removing a kick-off failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, error: 'Could not remove the kick-off. Try again.' };
  }
  revalidatePath('/schedule');
  return { ok: true };
}
