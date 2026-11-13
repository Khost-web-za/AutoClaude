import { describe, expect, it } from 'vitest';
import { activeNavKey, NAV_GROUPS } from '@/shell/nav-items';

describe('activeNavKey', () => {
  it.each([
    ['/', 'sessions'],
    ['/sessions/abc', 'sessions'],
    ['/sessions/new', 'new-session'],
    ['/sessions/new/', 'new-session'],
    ['/repos', 'repos'],
    ['/repos/o/n/secrets', 'repos'],
    ['/connections', 'connections'],
    ['/configs/default', 'configs'],
    ['/settings', 'settings'],
  ])('%s -> %s', (pathname, key) => {
    expect(activeNavKey(pathname)).toBe(key);
  });
});

describe('NAV_GROUPS', () => {
  it('lists the work and setup entries with their hrefs', () => {
    expect(NAV_GROUPS.map((g) => [g.key, g.entries.map((e) => e.href)])).toEqual([
      ['work', ['/', '/sessions/new', '/repos']],
      ['setup', ['/connections', '/configs', '/settings']],
    ]);
  });
});
