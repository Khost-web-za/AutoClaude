import { eq, inArray } from 'drizzle-orm';
import { db as sharedDb, type Db } from '@/db/client';
import { DEFAULT_RESUME_MESSAGE, repoSettings, type DeliveryMode } from '@/db/schema';

export type RepoSettings = {
  defaultBaseBranch: string | null;
  defaultProfiles: string[];
  deliveryMode: DeliveryMode;
  autoResume: boolean;
  resumeMessage: string;
};

const EMPTY: RepoSettings = {
  defaultBaseBranch: null,
  defaultProfiles: [],
  deliveryMode: 'pull_request',
  autoResume: false,
  resumeMessage: DEFAULT_RESUME_MESSAGE,
};

/** A repository's remembered defaults (none until set here or by starting a session). */
export async function readRepoSettings(repoFullName: string, conn: Db = sharedDb): Promise<RepoSettings> {
  const [row] = await conn
    .select({
      defaultBaseBranch: repoSettings.defaultBaseBranch,
      defaultProfiles: repoSettings.defaultProfiles,
      deliveryMode: repoSettings.deliveryMode,
      autoResume: repoSettings.autoResume,
      resumeMessage: repoSettings.resumeMessage,
    })
    .from(repoSettings)
    .where(eq(repoSettings.repoFullName, repoFullName));
  return row ?? EMPTY;
}

/** Each repository's resume message (the default where none is set), in one query. */
export async function readResumeMessages(repoFullNames: string[], conn: Db = sharedDb): Promise<Map<string, string>> {
  const rows = repoFullNames.length
    ? await conn
        .select({ repoFullName: repoSettings.repoFullName, resumeMessage: repoSettings.resumeMessage })
        .from(repoSettings)
        .where(inArray(repoSettings.repoFullName, repoFullNames))
    : [];
  const stored = new Map(rows.map((row) => [row.repoFullName, row.resumeMessage]));
  return new Map(repoFullNames.map((name) => [name, stored.get(name) ?? DEFAULT_RESUME_MESSAGE]));
}

export async function saveRepoSettings(repoFullName: string, values: RepoSettings, conn: Db = sharedDb): Promise<void> {
  await conn
    .insert(repoSettings)
    .values({ repoFullName, ...values })
    .onConflictDoUpdate({ target: repoSettings.repoFullName, set: values });
}
