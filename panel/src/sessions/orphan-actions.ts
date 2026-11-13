'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/auth/require-owner';
import { dockerStatusCode } from '@/docker/docker-errors';
import { removeSessionResources } from './delete-session';
import { listOrphans } from './reconcile';
import type { SessionActionResult } from './session-action-result';
import { sharedSessionDeps } from './session-deps';
import { isSessionId } from './session-record';

/** A full Docker container id, as `listOrphans` reports it. */
const containerIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Removes one orphan container (UI only, never automatic). The server re-checks with `listOrphans` that
 * it still carries the session label and has no live session row, so a row restored or recreated since
 * the page rendered is never touched.
 *
 * Rule, the same as deleting a session (`removeSessionResources`): the container goes with its anonymous
 * volumes, plus the session's named `-docker` volume when the label holds a valid session id. A label that
 * is not a session id names no volume, so only the container is removed.
 */
export async function removeOrphanAction(containerId: unknown): Promise<SessionActionResult> {
  await requireOwner();
  const parsed = containerIdSchema.safeParse(containerId);
  if (!parsed.success) return { ok: false, reason: 'invalid', message: 'That is not a container id.' };
  try {
    const orphan = (await listOrphans()).find((candidate) => candidate.containerId === parsed.data);
    if (!orphan) {
      return {
        ok: false,
        reason: 'not-found',
        message: 'That container is no longer an orphan (it is gone, or a session owns it). Reload.',
      };
    }
    const { docker } = sharedSessionDeps();
    if (isSessionId(orphan.sessionId)) {
      await removeSessionResources(docker, orphan.containerId, orphan.sessionId);
    } else {
      await docker
        .getContainer(orphan.containerId)
        .remove({ force: true, v: true })
        .catch((error: unknown) => {
          if (dockerStatusCode(error) !== 404) throw error;
        });
    }
  } catch (error) {
    console.error('[sessions] removing an orphan container failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, reason: 'unavailable', message: 'Could not remove the container. Docker may be unreachable; try again.' };
  }
  revalidatePath('/');
  return { ok: true, message: `Removed ${parsed.data.slice(0, 12)}.` };
}
