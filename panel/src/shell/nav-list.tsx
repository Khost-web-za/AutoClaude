'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeNavKey, NAV_GROUPS } from './nav-items';
import { NAV_ROW_ACTIVE_CLASS, NAV_ROW_CLASS, NAV_ROW_IDLE_CLASS } from './nav-row';

/** The grouped nav rows, shared by the desktop sidebar and the mobile sheet. */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const activeKey = activeNavKey(usePathname());
  return (
    <div className="flex flex-col gap-8">
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <p className="px-3 pb-1 font-mono text-[11px] tracking-widest text-text-subtle uppercase">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.entries.map((entry) => {
              const active = activeKey === entry.key;
              return (
                <li key={entry.key}>
                  <Link
                    href={entry.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`${NAV_ROW_CLASS} ${active ? NAV_ROW_ACTIVE_CLASS : NAV_ROW_IDLE_CLASS}`}
                  >
                    <entry.icon aria-hidden className="size-4" />
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
