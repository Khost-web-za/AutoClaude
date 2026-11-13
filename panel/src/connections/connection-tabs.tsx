'use client';

import { GitPullRequest, ShieldCheck, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { SegmentedTabs } from '@/ui/segmented-tabs';

const TABS = [
  { key: 'claude', label: 'Claude', href: '/connections/claude', icon: Sparkles },
  { key: 'github', label: 'GitHub', href: '/connections/github', icon: GitPullRequest },
  { key: 'cloudflare', label: 'Cloudflare Access', href: '/connections/cloudflare', icon: ShieldCheck },
] as const;

/** Claude / GitHub / Cloudflare Access pills; the track scrolls sideways on narrow phones. */
export function ConnectionTabs() {
  const pathname = usePathname();
  return (
    <SegmentedTabs
      label="Connections"
      items={TABS.map((tab) => ({ ...tab, current: pathname === tab.href || pathname.startsWith(`${tab.href}/`) }))}
    />
  );
}
