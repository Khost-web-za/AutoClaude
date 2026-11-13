'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { holdsRunningSlot } from '@/sessions/running-statuses';
import { useLive } from './use-live';

const DEBOUNCE_MS = 500;
/** Pages that list or show session rows. Everything else only changes when a slot is taken or freed. */
const SESSION_PAGE_PREFIXES = ['/repos/', '/sessions'];

/**
 * Renders nothing. Re-runs the server data after a `session` event, but only when it can change what
 * is on screen: the current page shows session rows, or the session entered or left the running
 * statuses (the footer's "Running n / max"). A working/waiting flip elsewhere is ignored.
 */
export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const slotHeld = useRef(new Map<string, boolean>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  });

  useLive((event) => {
    if (event.kind !== 'session') return;
    const holds = holdsRunningSlot(event.status);
    const before = slotHeld.current.get(event.sessionId);
    slotHeld.current.set(event.sessionId, holds);
    // Unseen session: it may have held a slot when the page rendered, so count it as a change.
    const slotChanged = before === undefined || before !== holds;
    const onSessionPage = SESSION_PAGE_PREFIXES.some((prefix) => pathnameRef.current.startsWith(prefix));
    if (!slotChanged && !onSessionPage) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return null;
}
