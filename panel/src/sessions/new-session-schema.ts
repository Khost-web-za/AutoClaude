import { z } from 'zod';
import { RepoNotAccessibleError } from '@/github/repos';
import { NoInstallationError } from '@/github/tokens';
import type { Profile } from '@/profiles/profile-catalog';
import { branchNameSchema } from '@/repos/branch-name';
import { STARTING_TASK_MAX } from './new-session-limits';
import type { StartSessionInput } from './start-session';

export { STARTING_TASK_MAX };

/** What the New session form sends. Everything is re-checked here; nothing from the browser is trusted. */
export const newSessionRequestSchema = z.object({
  repoFullName: z.string().trim().min(1, 'Pick a repository').max(200, 'Pick a repository from the list'),
  baseBranch: branchNameSchema,
  profiles: z.array(z.string().max(64)).max(64),
  startingTask: z
    .string()
    .max(STARTING_TASK_MAX, `At most ${STARTING_TASK_MAX.toLocaleString('en-US')} characters`)
    .nullish(),
});

export type NewSessionRequest = z.input<typeof newSessionRequestSchema>;

export type NewSessionValidation =
  | { ok: true; input: StartSessionInput }
  | { ok: false; fieldErrors: Record<string, string[]> };

type ValidationDeps = {
  profiles: readonly Profile[];
  /** `assertRepoAccessible`: canonical `Owner/Name`, or RepoNotAccessibleError. */
  resolveRepo: (fullName: string) => Promise<{ fullName: string }>;
};

/**
 * Checks a New session request: shape and limits first (no GitHub call for a malformed request), then that
 * every profile exists and that the GitHub App can see the repository. Answers with GitHub's canonical
 * repository name. A GitHub outage is thrown, not reported as "not accessible".
 */
export async function validateNewSession(raw: unknown, deps: ValidationDeps): Promise<NewSessionValidation> {
  const parsed = newSessionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0] ?? 'form')] ??= []).push(issue.message);
    return { ok: false, fieldErrors };
  }
  const request = parsed.data;
  const known = new Set(deps.profiles.map((profile) => profile.name));
  if (request.profiles.some((name) => !known.has(name))) {
    return { ok: false, fieldErrors: { profiles: ['Pick from the profiles shown; the list may have changed. Reload.'] } };
  }

  let fullName: string;
  try {
    fullName = (await deps.resolveRepo(request.repoFullName)).fullName;
  } catch (error) {
    if (error instanceof RepoNotAccessibleError || error instanceof NoInstallationError) {
      return { ok: false, fieldErrors: { repoFullName: ['The GitHub App cannot see that repository.'] } };
    }
    throw error;
  }

  const task = request.startingTask ?? '';
  return {
    ok: true,
    input: {
      repoFullName: fullName,
      baseBranch: request.baseBranch,
      profiles: [...new Set(request.profiles)],
      startingTask: task.trim() ? task : null,
    },
  };
}
