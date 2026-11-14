import { describe, expect, it } from 'vitest';
import { sessions } from '@/db/schema';
import { withTestDb } from '@/db/testing';
import { listRepoSessions } from '@/repos/repo-sessions';
import { readRepoSettings, saveRepoSettings } from '@/repos/repo-settings-store';

const session = (repoFullName: string, minutesAgo: number, extra: Partial<typeof sessions.$inferInsert> = {}) => ({
  repoFullName,
  baseBranch: 'main',
  workBranch: `claude/s-${minutesAgo}`,
  defaultBranch: 'main',
  secretHash: 'x',
  createdAt: new Date(Date.parse('2026-11-13T12:00:00Z') - minutesAgo * 60_000),
  ...extra,
});

describe('repository data', () => {
  it('lists only that repository’s live sessions, newest first, 20 per page', () =>
    withTestDb(async ({ db }) => {
      await db.insert(sessions).values([
        ...Array.from({ length: 22 }, (_, i) => session('Acme/Widgets', i)),
        session('Acme/Widgets', 100, { deletedAt: new Date() }),
        session('Acme/Other', 0),
      ]);
      const first = await listRepoSessions('Acme/Widgets', 1, db);
      expect(first).toMatchObject({ total: 22, pageCount: 2, page: 1 });
      expect(first.items[0]?.workBranch).toBe('claude/s-0');
      expect(Object.keys(first.items[0] ?? {})).not.toContain('secretHash');
      const second = await listRepoSessions('Acme/Widgets', 2, db);
      expect(second.items.map((row) => row.workBranch)).toEqual(['claude/s-20', 'claude/s-21']);
    }));

  it('reads empty defaults, then upserts settings', () =>
    withTestDb(async ({ db }) => {
      expect(await readRepoSettings('Acme/Widgets', db)).toEqual({
        defaultBaseBranch: null,
        defaultProfiles: [],
        deliveryMode: 'pull_request',
      });
      await saveRepoSettings('Acme/Widgets', { defaultBaseBranch: 'develop', defaultProfiles: ['frontend'] }, db);
      await saveRepoSettings('Acme/Widgets', { defaultBaseBranch: null, defaultProfiles: ['seo', 'frontend'] }, db);
      expect(await readRepoSettings('Acme/Widgets', db)).toEqual({
        defaultBaseBranch: null,
        defaultProfiles: ['seo', 'frontend'],
        deliveryMode: 'pull_request',
      });
    }));
});
