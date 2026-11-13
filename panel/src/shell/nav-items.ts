import { FolderGit2, Layers, LayoutList, Plug, Plus, Settings, type LucideIcon } from 'lucide-react';

export type NavKey = 'sessions' | 'new-session' | 'repos' | 'connections' | 'configs' | 'settings';
export type NavGroupKey = 'work' | 'setup';

export interface NavEntry {
  key: NavKey;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  key: NavGroupKey;
  label: string;
  entries: readonly NavEntry[];
}

/** Sidebar sections in order; the mobile sheet renders the same list. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    label: 'Work',
    entries: [
      { key: 'sessions', label: 'Sessions', href: '/', icon: LayoutList },
      { key: 'new-session', label: 'New session', href: '/sessions/new', icon: Plus },
      { key: 'repos', label: 'Repositories', href: '/repos', icon: FolderGit2 },
    ],
  },
  {
    key: 'setup',
    label: 'Setup',
    entries: [
      { key: 'connections', label: 'Connections', href: '/connections', icon: Plug },
      { key: 'configs', label: 'Configs', href: '/configs', icon: Layers },
      { key: 'settings', label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

const PREFIX_ENTRIES = [
  { prefix: '/repos', key: 'repos' },
  { prefix: '/connections', key: 'connections' },
  { prefix: '/configs', key: 'configs' },
  { prefix: '/settings', key: 'settings' },
] as const satisfies readonly { prefix: string; key: NavKey }[];

/** Which nav row owns a path. `/sessions/new` is its own row; every other `/sessions/*` is Sessions. */
export function activeNavKey(pathname: string): NavKey {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/sessions/new' || path.startsWith('/sessions/new/')) return 'new-session';
  const match = PREFIX_ENTRIES.find(
    ({ prefix }) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return match?.key ?? 'sessions';
}
