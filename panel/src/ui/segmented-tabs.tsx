import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

export interface SegmentedTabItem {
  key: string;
  label: string;
  href: string;
  current: boolean;
  count?: number;
  /** Overrides the row-wide icon for this item. */
  icon?: LucideIcon;
}

/** A row of link pills on one rounded track. Scrolls sideways on phones. */
export function SegmentedTabs({
  label,
  items,
  icon: Icon,
}: {
  label: string;
  items: readonly SegmentedTabItem[];
  /** Optional icon shown before every label. */
  icon?: LucideIcon;
}) {
  return (
    <nav
      aria-label={label}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max gap-1 rounded-full bg-surface p-1">
        {items.map(({ icon: ItemIcon = Icon, ...item }) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-focus motion-reduce:transition-none ${item.current ? 'bg-accent-soft text-accent-text' : 'text-muted hover:text-white'}`}
            >
              {ItemIcon ? <ItemIcon aria-hidden className="size-3.5" /> : null}
              {item.label}
              {item.count !== undefined ? (
                <span className="font-mono text-xs opacity-70">{item.count}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
