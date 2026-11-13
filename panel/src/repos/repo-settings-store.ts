import { eq } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { repoSettings } from '@/db/schema';

export type RepoSettings = { defaultBaseBranch: string | null; defaultProfiles: string[] };

const EMPTY: RepoSettings = { defaultBaseBranch: null, defaultProfiles: [] };

/** A repository's remembered defaults (none until set here or by starting a session). */
export async function readRepoSettings(repoFullName: string, conn: Db = sharedDb): Promise<RepoSettings> {
  const [row] = await conn
    .select({ defaultBaseBranch: repoSettings.defaultBaseBranch, defaultProfiles: repoSettings.defaultProfiles })
    .from(repoSettings)
    .where(eq(repoSettings.repoFullName, repoFullName));
  return row ?? EMPTY;
}

export async function saveRepoSettings(repoFullName: string, values: RepoSettings, conn: Db = sharedDb): Promise<void> {
  await conn
    .insert(repoSettings)
    .values({ repoFullName, ...values })
    .onConflictDoUpdate({ target: repoSettings.repoFullName, set: values });
}
