'use client';

import { Activity, FileDiff, LayoutDashboard, ScrollText } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { SegmentedTabs } from '@/ui/segmented-tabs';

/** Overview / Changes / Activity / Logs pills of one session. `changes` is unpushed + uncommitted when known. */
export function SessionDetailTabs({ sessionId, changes }: { sessionId: string; changes: number | null }) {
  const pathname = usePathname();
  const base = `/sessions/${sessionId}`;
  const tabs = [
    { key: 'overview', label: 'Overview', href: base, icon: LayoutDashboard },
    { key: 'changes', label: 'Changes', href: `${base}/changes`, icon: FileDiff, count: changes ?? undefined },
    { key: 'activity', label: 'Activity', href: `${base}/activity`, icon: Activity },
    { key: 'logs', label: 'Logs', href: `${base}/logs`, icon: ScrollText },
  ];
  const current = (href: string) => (href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`));
  return <SegmentedTabs label="Session" items={tabs.map((tab) => ({ ...tab, current: current(tab.href) }))} />;
}
