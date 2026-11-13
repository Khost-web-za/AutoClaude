import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type Docker from 'dockerode';
import { sessions, type SessionGitState } from '@/db/schema';
import { dockerErrorDetail } from '@/docker/docker-errors';
import { sharedSessionDeps, type SessionDeps, type SessionDocker } from './session-deps';
import { loadLiveSession } from './session-record';

export type GitState = SessionGitState;

const REPO_DIR = '/workspace/repo';
const SESSION_USER = '1000:1000';
/** In-container limit per command, and a hard stop for the exec stream itself. */
const COMMAND_TIMEOUT_S = 20;
const EXEC_DEADLINE_MS = 30_000;

type ExecResult = { exitCode: number; stdout: string; stderr: string };

function collector(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
}

async function execInRepo(docker: SessionDocker, container: Docker.Container, cmd: string[]): Promise<ExecResult> {
  const exec = await container.exec({
    Cmd: ['timeout', String(COMMAND_TIMEOUT_S), ...cmd],
    User: SESSION_USER,
    WorkingDir: REPO_DIR,
    Env: ['HOME=/home/claude'],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  docker.modem.demuxStream(stream, collector(stdout), collector(stderr));
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', reject);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('git command timed out')), EXEC_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? -1,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

const nonBlankLines = (text: string) => text.split('\n').filter((line) => line.trim() !== '');

function commandError(label: string, result: ExecResult): string {
  const tail = result.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200);
  return `${label} failed (exit ${result.exitCode})${tail ? `: ${tail}` : ''}`;
}

/** One `git status --porcelain` entry: the two-letter code (`M `, `??`, …) and the path. */
export type ChangedFile = { code: string; path: string };
/** One unpushed commit: short sha and subject. */
export type UnpushedCommit = { sha: string; subject: string };
/** The workspace's git state plus the lists behind its counts (empty when the state is unknown). */
export type WorkChanges = { state: GitState; files: ChangedFile[]; commits: UnpushedCommit[] };

/** Reads uncommitted files, unpushed commits and the PR url from the container. Never throws. */
export async function readWorkChanges(docker: SessionDocker, containerId: string | null): Promise<WorkChanges> {
  const checkedAt = new Date().toISOString();
  const unknown = (error: string): WorkChanges => ({
    state: { unpushedCommits: 0, uncommittedFiles: 0, prUrl: null, checkedAt, error },
    files: [],
    commits: [],
  });
  if (!containerId) return unknown('the session has no container');
  try {
    const container = docker.getContainer(containerId);
    const [status, unpushed, pr] = await Promise.all([
      execInRepo(docker, container, ['git', 'status', '--porcelain']),
      execInRepo(docker, container, ['git', 'log', '--branches', '--not', '--remotes', '--oneline']),
      // Best-effort: no PR, no network or no gh auth all just mean "no url".
      execInRepo(docker, container, ['gh', 'pr', 'view', '--json', 'url', '-q', '.url']).catch(() => null),
    ]);
    if (status.exitCode !== 0) return unknown(commandError('git status', status));
    if (unpushed.exitCode !== 0) return unknown(commandError('git log', unpushed));
    const url = pr?.exitCode === 0 ? pr.stdout.trim() : '';
    const files = nonBlankLines(status.stdout).map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
    const commits = nonBlankLines(unpushed.stdout).map((line) => {
      const space = line.indexOf(' ');
      return space === -1 ? { sha: line, subject: '' } : { sha: line.slice(0, space), subject: line.slice(space + 1) };
    });
    return {
      state: {
        unpushedCommits: commits.length,
        uncommittedFiles: files.length,
        prUrl: /^https:\/\/\S+$/.test(url) ? url : null,
        checkedAt,
      },
      files,
      commits,
    };
  } catch (error) {
    return unknown(`could not run git in the container: ${dockerErrorDetail(error)}`);
  }
}

/** The counts only (list rows, the delete check). Never throws. */
export async function readGitState(docker: SessionDocker, containerId: string | null): Promise<GitState> {
  return (await readWorkChanges(docker, containerId)).state;
}

/** Re-reads the workspace with its file and commit lists (Changes tab) and stores the counts on the row. */
export async function refreshWorkChanges(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<WorkChanges> {
  const row = await loadLiveSession(deps.db, id);
  const changes = await readWorkChanges(deps.docker, row.containerId);
  await deps.db.update(sessions).set({ gitState: changes.state }).where(eq(sessions.id, row.id));
  return changes;
}

/** Re-reads the git state of a session's workspace and stores it on the row. Failures land in `error`. */
export async function refreshGitState(id: string, deps: SessionDeps = sharedSessionDeps()): Promise<GitState> {
  const row = await loadLiveSession(deps.db, id);
  const state = await readGitState(deps.docker, row.containerId);
  await deps.db.update(sessions).set({ gitState: state }).where(eq(sessions.id, row.id));
  return state;
}
