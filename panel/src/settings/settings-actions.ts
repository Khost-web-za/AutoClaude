'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/auth/require-owner';
import { formEntries, type FormState } from '@/feedback/form-state';
import { parseSettingsForm } from './settings-schemas';
import { saveSettings } from './settings-store';

/** Saves the Settings form. Everything is re-validated here; the form's min/max are only hints. */
export async function updateSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = parseSettingsForm(formEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: parsed.fieldErrors };
  }
  await saveSettings(parsed.data);
  // The header (usage thresholds, reset display) reads these on every page.
  revalidatePath('/', 'layout');
  return { status: 'success', message: 'Settings saved.' };
}
