/** What a form's server action answers (`useActionState`). Messages are safe to show; never a secret. */
export type FormState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> };

export const IDLE_FORM: FormState = { status: 'idle' };

export type FormAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Plain string entries of a submission (files and repeated keys are not used by panel forms). */
export function formEntries(formData: FormData): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === 'string' && !key.startsWith('$')) entries[key] = value;
  return entries;
}
