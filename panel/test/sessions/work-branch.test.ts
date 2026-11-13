import { describe, expect, it } from 'vitest';
import { sessionShortId, workBranchName } from '@/sessions/work-branch';

const ID = 'a1f3c0de-1111-4222-8333-444455556666';

describe('workBranchName', () => {
  it('slugs the starting task and appends the short id', () => {
    expect(workBranchName('Fix the Pagination bug!!', ID)).toBe('claude/fix-the-pagination-bug-a1f3');
  });

  it('truncates the slug to 30 characters without a trailing dash', () => {
    const branch = workBranchName('Refactor the entire authentication module and its tests', ID);
    const slug = branch.slice('claude/'.length, -'-a1f3'.length);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug).toBe('refactor-the-entire-authentica');
    // A cut that lands right after a separator drops it.
    const a29 = 'a'.repeat(29);
    expect(workBranchName(`${a29} bbb`, ID)).toBe(`claude/${a29}-a1f3`);
  });

  it('falls back to "session" for null, blank or symbol-only tasks', () => {
    expect(workBranchName(null, ID)).toBe('claude/session-a1f3');
    expect(workBranchName('   ', ID)).toBe('claude/session-a1f3');
    expect(workBranchName('!!! 🚀 ???', ID)).toBe('claude/session-a1f3');
  });

  it('keeps only [a-z0-9-], folding accents and newlines', () => {
    expect(workBranchName('Café crème\nüber  ~^:?*[ refs', ID)).toBe('claude/cafe-creme-uber-refs-a1f3');
  });

  it('short id is the first 4 hex of the session id', () => {
    expect(sessionShortId('A1F3C0DE-1111-4222-8333-444455556666')).toBe('a1f3');
  });
});
