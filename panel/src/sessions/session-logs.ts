import { dockerStatusCode } from '@/docker/docker-errors';
import { secretStore as sharedSecretStore, type SecretStore } from '@/secret-store/secret-store';
import { repoSecretPrefix } from '@/repos/secret-schemas';
import { stripAnsi } from '@/claude/ansi';
import { sharedSessionDeps, type SessionDocker } from './session-deps';

export const LOG_TAIL_LINES = 500;
export const REDACTED = '••••';
const LOG_TIMEOUT_MS = 10_000;

/**
 * A Docker log body as lines. Containers without a TTY send 8-byte framed stdout/stderr chunks
 * (`[stream, 0, 0, 0, size BE32]`); anything that does not parse as frames is read as raw text.
 */
export function demuxDockerLog(buffer: Buffer): string[] {
  const parts: Buffer[] = [];
  let offset = 0;
  let framed = buffer.length >= 8;
  while (framed && offset < buffer.length) {
    const stream = buffer[offset];
    const size = offset + 8 <= buffer.length ? buffer.readUInt32BE(offset + 4) : -1;
    if ((stream !== 0 && stream !== 1 && stream !== 2) || buffer[offset + 1] !== 0 || size < 0 || offset + 8 + size > buffer.length) {
      framed = false;
      break;
    }
    parts.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  const text = (framed ? Buffer.concat(parts) : buffer).toString('utf8');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Every string to hide: each value, and each non-blank line of a multi-line value. Longest first. */
function needles(secretValues: readonly string[]): string[] {
  const all = new Set<string>();
  for (const value of secretValues) {
    if (value) all.add(value);
    if (value.includes('\n')) for (const line of value.split(/\r?\n/)) if (line.trim()) all.add(line);
  }
  return [...all].sort((a, b) => b.length - a.length);
}

/** R6: strips ANSI first (so a code inside a value cannot hide it), then replaces every secret occurrence. */
export function redactLogLines(lines: readonly string[], secretValues: readonly string[]): string[] {
  const hide = needles(secretValues);
  return lines.map((raw) => {
    let line = stripAnsi(raw);
    for (const needle of hide) if (line.includes(needle)) line = line.split(needle).join(REDACTED);
    return line;
  });
}

export type SessionLogs = { ok: true; lines: string[] } | { ok: false; message: string };

/**
 * The last 500 lines of the session container's output, ANSI-stripped and with the repository's secret
 * values replaced by ••••. Runs server-side only: secret values never leave this function.
 */
export async function readSessionLogs(
  session: { containerId: string | null; repoFullName: string },
  deps: { docker: SessionDocker; secretStore: Pick<SecretStore, 'getMany'> } = {
    docker: sharedSessionDeps().docker,
    secretStore: sharedSecretStore,
  },
): Promise<SessionLogs> {
  if (!session.containerId) return { ok: false, message: 'This session has no container, so there are no logs.' };
  const prefix = repoSecretPrefix(session.repoFullName);
  let timer: NodeJS.Timeout | undefined;
  try {
    const [body, secrets] = await Promise.race([
      Promise.all([
        deps.docker.getContainer(session.containerId).logs({
          stdout: true,
          stderr: true,
          tail: LOG_TAIL_LINES,
          follow: false,
        }) as Promise<Buffer | string>,
        deps.secretStore.getMany('repo', prefix),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), LOG_TIMEOUT_MS);
      }),
    ]);
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return { ok: true, lines: redactLogLines(demuxDockerLog(buffer).slice(-LOG_TAIL_LINES), Object.values(secrets)) };
  } catch (error) {
    if (dockerStatusCode(error) === 404) return { ok: false, message: 'The container is gone, so its logs are too.' };
    console.error('[sessions] reading container logs failed:', error instanceof Error ? error.name : 'error');
    return { ok: false, message: 'Could not read the container logs. Docker may be unreachable; try again.' };
  } finally {
    clearTimeout(timer);
  }
}
