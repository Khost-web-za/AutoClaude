'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { shouldFocusSearch } from './search-shortcut';

/** Sessions search (repository or task): a GET form to `/?q=`. Pressing `/` outside an input focuses it. */
export function GlobalSearch({ className = '' }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Hidden instances (the desktop bar below lg) must not swallow the key.
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      if (
        shouldFocusSearch({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          target: event.target as HTMLElement | null,
        })
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form method="get" action="/" role="search" className={`w-full ${className}`}>
      <label className="relative block">
        <span className="sr-only">Search sessions by repository or task</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-subtle"
        />
        <input
          ref={inputRef}
          type="search"
          name="q"
          maxLength={100}
          placeholder="Search sessions…"
          className="h-10 w-full rounded-xl border border-border bg-field-background pr-10 pl-10 text-sm text-white placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-focus"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-border px-1.5 font-mono text-[11px] text-text-subtle lg:block">
          /
        </kbd>
      </label>
    </form>
  );
}
