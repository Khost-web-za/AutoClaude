'use client';

import { KeyRound, Settings2, SquareTerminal } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { SegmentedTabs } from '@/ui/segmented-tabs';

/** Sessions / Secrets / Settings pills of one repository. `basePath` is `/repos/Owner/Name`. */
export function RepoTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const tabs = [
    { key: 'sessions', label: 'Sessions', href: basePath, icon: SquareTerminal },
    { key: 'secrets', label: 'Secrets', href: `${basePath}/secrets`, icon: KeyRound },
    { key: 'settings', label: 'Settings', href: `${basePath}/settings`, icon: Settings2 },
  ];
  const current = (href: string) =>
    href === basePath ? pathname === basePath : pathname === href || pathname.startsWith(`${href}/`);
  return <SegmentedTabs label="Repository" items={tabs.map((tab) => ({ ...tab, current: current(tab.href) }))} />;
}
