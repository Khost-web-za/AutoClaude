import { dockerStatusCode } from '@/docker/docker-errors';
import { sharedSessionDeps, type SessionDeps } from './session-deps';
import { loadLiveSession, setSessionStatus } from './session-record';

const STOP_TIMEOUT_S = 10;

/** Stops the container (kept, with its workspace) and marks the session `stopped`. */
export async function stopSession(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<void> {
  const row = await loadLiveSession(deps.db, id);
  let detail: string | null = null;
  if (row.containerId) {
    try {
      await deps.docker.getContainer(row.containerId).stop({ t: STOP_TIMEOUT_S });
    } catch (error) {
      const status = dockerStatusCode(error);
      // 304: already stopped. 404: gone; the session is stopped either way.
      if (status === 404) detail = 'container missing';
      else if (status !== 304) throw error;
    }
  }
  await setSessionStatus(deps, row.id, 'stopped', detail, { endedAt: new Date() });
}
