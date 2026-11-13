import { describe, expect, it } from 'vitest';
import { getRepo, listBranches, listRepos, RepoNotAccessibleError } from '@/github/repos';
import { seedApp, seedInstallation, tokenReply, withGithub, type GithubCtx } from './github-fixtures';

const repo = (fullName: string, pushedAt: string | null, extra: Record<string, unknown> = {}) => ({
  full_name: fullName,
  private: false,
  default_branch: 'main',
  pushed_at: pushedAt,
  ...extra,
});

function stubInstallation(ctx: GithubCtx, id: number, repos: ReturnType<typeof repo>[]) {
  ctx.stub.on(`POST /app/installations/${id}/access_tokens`, tokenReply(`ghs_${id}`, 3_600_000, ctx.clock));
  ctx.stub.on('GET /installation/repositories', (req) => {
    const token = String(req.headers.authorization);
    if (token !== `Bearer ghs_${id}`) return { status: 404, json: {} };
    const perPage = Number(req.query.get('per_page') ?? 30);
    const page = Number(req.query.get('page') ?? 1);
    const slice = repos.slice((page - 1) * perPage, page * perPage);
    const lastPage = Math.max(1, Math.ceil(repos.length / perPage));
    const headers: Record<string, string> = {};
    if (page < lastPage) {
      headers.link = `<${ctx.stub.url}/installation/repositories?per_page=${perPage}&page=${lastPage}>; rel="last"`;
    }
    return { json: { total_count: repos.length, repositories: slice }, headers };
  });
}

describe('listRepos', () => {
  it('merges installations, sorts by pushedAt desc and paginates 20 per page', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      await seedInstallation(ctx, 2, 'octocat');
      const day = (n: number) => new Date(Date.UTC(2029, 0, n)).toISOString();
      // Two installations answered by one path, so tokens tell them apart.
      const byToken: Record<string, ReturnType<typeof repo>[]> = {
        ghs_1: Array.from({ length: 15 }, (_, i) => repo(`acme/a${i}`, day(i + 1))),
        ghs_2: [...Array.from({ length: 10 }, (_, i) => repo(`octocat/k${i}`, day(i + 16))), repo('octocat/never', null, { private: true })],
      };
      ctx.stub.on('POST /app/installations/1/access_tokens', tokenReply('ghs_1', 3_600_000, ctx.clock));
      ctx.stub.on('POST /app/installations/2/access_tokens', tokenReply('ghs_2', 3_600_000, ctx.clock));
      ctx.stub.on('GET /installation/repositories', (req) => {
        const list = byToken[String(req.headers.authorization).replace('Bearer ', '')] ?? [];
        return { json: { total_count: list.length, repositories: list } };
      });

      const first = await listRepos({ page: 1, query: '' }, ctx.deps);
      expect(first).toMatchObject({ page: 1, pageSize: 20, total: 26, pageCount: 2 });
      expect(first.items).toHaveLength(20);
      expect(first.items[0]).toEqual({
        fullName: 'octocat/k9',
        private: false,
        defaultBranch: 'main',
        pushedAt: day(25),
      });
      const pushed = first.items.map((i) => i.pushedAt ?? '');
      expect([...pushed].sort().reverse()).toEqual(pushed);

      const second = await listRepos({ page: 2, query: '' }, ctx.deps);
      expect(second.items).toHaveLength(6);
      expect(second.items.at(-1)).toMatchObject({ fullName: 'octocat/never', private: true, pushedAt: null });
    });
  });

  it('filters by query case-insensitively', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      stubInstallation(ctx, 1, [repo('acme/Widgets', '2029-01-02T00:00:00Z'), repo('acme/gadgets', '2029-01-01T00:00:00Z')]);
      const result = await listRepos({ page: 1, query: 'WIDG' }, ctx.deps);
      expect(result.items.map((i) => i.fullName)).toEqual(['acme/Widgets']);
      expect(result.total).toBe(1);
    });
  });

  it('caches each installation for 60s, fetches extra pages in parallel and survives one failing installation', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      await seedInstallation(ctx, 2, 'broken');
      const many = Array.from({ length: 250 }, (_, i) => repo(`acme/r${i}`, new Date(Date.UTC(2029, 0, 1, 0, i)).toISOString()));
      stubInstallation(ctx, 1, many);
      ctx.stub.on('POST /app/installations/2/access_tokens', { status: 404, json: { message: 'gone' } });

      const result = await listRepos({ page: 1, query: '' }, ctx.deps);
      expect(result.total).toBe(250);
      expect(ctx.stub.count('GET /installation/repositories')).toBe(3);

      await listRepos({ page: 2, query: 'r1' }, ctx.deps);
      expect(ctx.stub.count('GET /installation/repositories')).toBe(3);

      ctx.clock.now += 61_000;
      await listRepos({ page: 1, query: '' }, ctx.deps);
      expect(ctx.stub.count('GET /installation/repositories')).toBe(6);
    });
  });

  it('clamps a page past the end to the last page', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      stubInstallation(ctx, 1, [repo('acme/one', '2029-01-01T00:00:00Z')]);
      expect(await listRepos({ page: 9, query: '' }, ctx.deps)).toMatchObject({ page: 1, total: 1 });
    });
  });
});

describe('listBranches', () => {
  it('lists the repo branches through a repo-scoped token, filtered and paginated', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'Acme');
      ctx.stub.on('POST /app/installations/1/access_tokens', tokenReply('ghs_b', 3_600_000, ctx.clock));
      const names = ['main', ...Array.from({ length: 24 }, (_, i) => `feature/f${i}`)];
      ctx.stub.on('GET /repos/acme/widgets/branches', (req) => {
        const perPage = Number(req.query.get('per_page'));
        const page = Number(req.query.get('page') ?? 1);
        return { json: names.slice((page - 1) * perPage, page * perPage).map((name) => ({ name, protected: name === 'main' })) };
      });

      const first = await listBranches('acme/widgets', { page: 1, query: '' }, ctx.deps);
      expect(first).toMatchObject({ total: 25, pageCount: 2, pageSize: 20 });
      expect(first.items[0]).toEqual({ name: 'main', protected: true });

      const filtered = await listBranches('acme/widgets', { page: 1, query: 'F1' }, ctx.deps);
      expect(filtered.items.map((b) => b.name)).toEqual(
        names.filter((n) => n.toLowerCase().includes('f1')),
      );
      const tokenBody = ctx.stub.requests.find((r) => r.path.endsWith('/access_tokens'))?.body as { repositories: string[] };
      expect(tokenBody.repositories).toEqual(['widgets']);
    });
  });
});

describe('getRepo', () => {
  it('finds a repo of the owner installation case-insensitively, rejects unknown ones', async () => {
    await withGithub(async (ctx) => {
      await seedApp(ctx);
      await seedInstallation(ctx, 1, 'acme');
      stubInstallation(ctx, 1, [repo('acme/Widgets', null, { default_branch: 'trunk' })]);
      expect(await getRepo('acme/widgets', ctx.deps)).toMatchObject({ fullName: 'acme/Widgets', defaultBranch: 'trunk' });
      await expect(getRepo('acme/nope', ctx.deps)).rejects.toBeInstanceOf(RepoNotAccessibleError);
      await expect(getRepo('other/thing', ctx.deps)).rejects.toThrow(/not installed/);
    });
  });
});
