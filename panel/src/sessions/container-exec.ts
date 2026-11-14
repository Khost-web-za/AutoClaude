import { Writable } from 'node:stream';
import type Docker from 'dockerode';
import type { SessionDocker } from './session-deps';

const REPO_DIR = '/workspace/repo';
const SESSION_USER = '1000:1000';
/** In-container limit per command, and a hard stop for the exec stream itself. */
const COMMAND_TIMEOUT_S = 20;
const EXEC_DEADLINE_MS = 30_000;

export type ExecResult = { exitCode: number; stdout: string; stderr: string };

function collector(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
}

export async function execInRepo(docker: SessionDocker, container: Docker.Container, cmd: string[]): Promise<ExecResult> {
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
