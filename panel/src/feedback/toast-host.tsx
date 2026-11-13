'use client';

import { Toast, toast } from '@heroui/react';
import type { FormAction } from './form-state';

/** One toast region for the whole panel (root layout). */
export function ToastHost() {
  return <Toast.Provider placement="bottom" />;
}

export function notifySuccess(message: string): void {
  toast.success(message);
}

export function notifyError(message: string): void {
  toast.danger(message);
}

export const UNREACHABLE_MESSAGE = 'The panel could not be reached. Try again.';

/**
 * Toasts the outcome as soon as the action answers. For forms that re-key or unmount when the new
 * server state arrives, where an effect on the state would never run. A call that throws (network,
 * server crash) becomes an error toast instead of the error page.
 */
export function withToast(action: FormAction): FormAction {
  return async (previous, formData) => {
    let next: Awaited<ReturnType<FormAction>>;
    try {
      next = await action(previous, formData);
    } catch {
      notifyError(UNREACHABLE_MESSAGE);
      return { status: 'error', message: UNREACHABLE_MESSAGE };
    }
    if (next.status === 'success') notifySuccess(next.message);
    else if (next.status === 'error' && !next.fieldErrors) notifyError(next.message);
    return next;
  };
}
