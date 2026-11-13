import { eq, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { githubInstallations } from '@/db/schema';
import { paginate, type PageResult } from '@/db/pagination';
import { appJwt } from './app-store';
import { githubGetAll, githubRequest } from './github-api';
import type { GithubDeps } from './github-deps';

export type InstallationRow = typeof githubInstallations.$inferSelect;

const installationResponse = z.object({
  id: z.number().int().positive(),
  account: z.object({ login: z.string().min(1), type: z.string().min(1) }),
  permissions: z.record(z.string(), z.string()).default({}),
});

const toRow = (installation: z.infer<typeof installationResponse>) => ({
  installationId: installation.id,
  accountLogin: installation.account.login,
  accountType: installation.account.type,
  permissions: installation.permissions,
});

/** Records an installation after GitHub confirms, with the app JWT, that it belongs to this App. */
export async function recordInstallation(installationId: number, deps: GithubDeps): Promise<void> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error('Invalid installation id');
  const { json } = await githubRequest(deps.apiUrl, `/app/installations/${installationId}`, {
    token: await appJwt(deps),
  });
  const row = toRow(installationResponse.parse(json));
  await deps.db
    .insert(githubInstallations)
    .values(row)
    .onConflictDoUpdate({
      target: githubInstallations.installationId,
      set: { accountLogin: row.accountLogin, accountType: row.accountType, permissions: row.permissions },
    });
}

export function countInstallations(deps: GithubDeps): Promise<number> {
  return deps.db.$count(githubInstallations);
}

/** Every installation. One per GitHub account the App is installed on, so the set is small by nature. */
export function listInstallations(deps: GithubDeps): Promise<InstallationRow[]> {
  return deps.db.select().from(githubInstallations).orderBy(githubInstallations.accountLogin);
}

export function listInstallationsPage(page: number, deps: GithubDeps): Promise<PageResult<InstallationRow>> {
  return paginate(
    deps.db,
    () => deps.db.select().from(githubInstallations).orderBy(githubInstallations.accountLogin).$dynamic(),
    { page },
  );
}

/** The installation whose account matches the repo owner, case-insensitively. */
export async function findInstallationForOwner(owner: string, deps: GithubDeps): Promise<InstallationRow | null> {
  const [row] = await deps.db
    .select()
    .from(githubInstallations)
    .where(eq(sql`lower(${githubInstallations.accountLogin})`, owner.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/** Mirrors GET /app/installations: upserts what GitHub lists and forgets installations that were removed. */
export async function syncInstallations(deps: GithubDeps): Promise<void> {
  const listed = await githubGetAll(deps.apiUrl, '/app/installations', {
    token: await appJwt(deps),
    extract: (json) => z.array(installationResponse).parse(json),
  });
  const rows = listed.map(toRow);
  await deps.db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(githubInstallations)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: githubInstallations.installationId,
          set: {
            accountLogin: sql`excluded.account_login`,
            accountType: sql`excluded.account_type`,
            permissions: sql`excluded.permissions`,
          },
        });
    }
    const ids = rows.map((row) => row.installationId);
    await tx
      .delete(githubInstallations)
      .where(ids.length > 0 ? notInArray(githubInstallations.installationId, ids) : undefined);
  });
}
