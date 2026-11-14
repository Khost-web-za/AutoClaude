import { eq } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { repoSettings, type DeliveryMode } from '@/db/schema';

export type RepoSettings = { defaultBaseBranch: string | null; defaultProfiles: string[]; deliveryMode: DeliveryMode };

const EMPTY: RepoSettings = { defaultBaseBranch: null, defaultProfiles: [], deliveryMode: 'pull_request' };

/** A repository's remembered defaults (none until set here or by starting a session). */
export async function readRepoSettings(repoFullName: string, conn: Db = sharedDb): Promise<RepoSettings> {
  const [row] = await conn
    .select({
      defaultBaseBranch: repoSettings.defaultBaseBranch,
      defaultProfiles: repoSettings.defaultProfiles,
      deliveryMode: repoSettings.deliveryMode,
    })
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
