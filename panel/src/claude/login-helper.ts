import { randomUUID } from 'node:crypto';
import { Writable, type Duplex } from 'node:stream';
import type { Container } from 'dockerode';
import { docker } from '@/docker/docker-client';
import { discoverStack } from '@/docker/self-discovery';
import { credentialsVolume, parseCredentials, type CredentialsVolume } from './credentials-volume';

const LOGIN_LABEL = 'claudecloud.role';
const HELPER_HOME = '/home/claude';
const HELPER_CREDENTIALS = `${HELPER_HOME}/.claude/.credentials.json`;
const MAX_LIFETIME_MS = 10 * 60 * 1000;
const URL_TIMEOUT_MS = 60_000;
const SUCCESS_TIMEOUT_MS = 90_000;
const POLL_MS = 1000;
const LINGER_SECONDS = 30;
const URL_SETTLE_MS = 1500;
const MAX_CODE_LENGTH = 512;
const MAX_BUFFER = 64 * 1024;

// Lenient default from the panel spikes (host/path may vary); the TTY output is ANSI-stripped first.
const LOGIN_URL = /https:\/\/claude\.(?:com|ai)\/[^\s"'<>]*oauth\/authorize\?[^\s"'<>]+/;
const CODE_PROMPT = /Paste code here/i;
 
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, '');

/** First login URL in raw TTY output; rejoins a URL the terminal wrapped across lines. */
export function extractLoginUrl(raw: string): string | null {
  const text = stripAnsi(raw).replace(/\r/g, '');
  const match = LOGIN_URL.exec(text);
  if (!match) return null;
  const lines = text.slice(match.index).split('\n');
  let url = /^\S+/.exec(lines[0] ?? '')?.[0] ?? '';
  // Only a line that is entirely one token can be a wrapped continuation (the prompt line has spaces).
  for (let i = 1; i < lines.length && /^\S+$/.test(lines[i] ?? ''); i++) url += lines[i];
  return LOGIN_URL.test(url) ? LOGIN_URL.exec(url)![0] : null;
}

export const hasCodePrompt = (raw: string): boolean => CODE_PROMPT.test(stripAnsi(raw));

/** Trimmed code, or null when it cannot be a pasted OAuth code (never forward arbitrary input to the TTY). */
export function validateLoginCode(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > MAX_CODE_LENGTH) return null;
   
  return /[\u0000-\u001f\u007f]/.test(trimmed) ? null : trimmed;
}

type LoginSession = {
  container: Container;
  stream: Duplex;
  output: string;
  exited: boolean;
  lastDataAt: number;
  timer: NodeJS.Timeout;
};

const sessions = new Map<string, LoginSession>();

export type StartLoginOptions = {
  /** Test seams: the real flow uses the runner image and `claude auth login`. */
  image?: string;
  command?: { entrypoint: string[]; cmd: string[] };
  volume?: CredentialsVolume;
  timeouts?: { url?: number; success?: number };
};

const optionsByLogin = new Map<string, StartLoginOptions>();

async function removeContainer(container: Container): Promise<void> {
  await container.remove({ force: true }).catch(() => undefined);
}

async function dispose(loginId: string): Promise<void> {
  const session = sessions.get(loginId);
  if (!session) return;
  sessions.delete(loginId);
  optionsByLogin.delete(loginId);
  clearTimeout(session.timer);
  session.stream.destroy();
  await removeContainer(session.container);
}

/**
 * Reads the helper's credentials file via `exec cat` (the archive API cannot see tmpfs mounts);
 * null while the file does not exist yet.
 */
async function readHelperCredentials(container: Container): Promise<string | null> {
  try {
    const exec = await container.exec({ Cmd: ['cat', HELPER_CREDENTIALS], AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const out: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        out.push(chunk);
        done();
      },
    });
    docker.modem.demuxStream(stream, sink, new Writable({ write: (_c, _e, done) => done() }));
    await new Promise<void>((resolve) => {
      stream.on('end', resolve);
      stream.on('error', resolve);
      stream.on('close', resolve);
    });
    if ((await exec.inspect()).ExitCode !== 0) return null;
    return Buffer.concat(out).toString('utf8');
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(timeoutMs: number, probe: () => Promise<T | null> | T | null): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

function newSession(loginId: string, container: Container, stream: Duplex): LoginSession {
  const session: LoginSession = {
    container,
    stream,
    output: '',
    exited: false,
    lastDataAt: Date.now(),
    timer: setTimeout(() => void dispose(loginId), MAX_LIFETIME_MS),
  };
  session.timer.unref();
  const markExited = () => {
    session.exited = true;
  };
  stream.on('data', (chunk: Buffer) => {
    session.output = (session.output + chunk.toString('utf8')).slice(-MAX_BUFFER);
    session.lastDataAt = Date.now();
  });
  stream.on('end', markExited);
  stream.on('close', markExited);
  stream.on('error', markExited);
  return session;
}

/** Starts `claude auth login` in a throwaway helper container and resolves once the URL is printed. */
export function startLogin(options: StartLoginOptions = {}): Promise<{ loginId: string; url: string }> {
  // Serialised: concurrent starts queue up instead of racing each other's cleanup.
  const run = startLock.then(() => startLoginUnlocked(options));
  startLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let startLock: Promise<void> = Promise.resolve();

/** Force-removes every login helper left behind by a crashed or redeployed panel. */
export async function removeStaleLoginHelpers(): Promise<number> {
  const stale = await docker.listContainers({ all: true, filters: { label: [`${LOGIN_LABEL}=login`] } });
  await Promise.all(stale.map((info) => removeContainer(docker.getContainer(info.Id))));
  return stale.length;
}

async function startLoginUnlocked(options: StartLoginOptions): Promise<{ loginId: string; url: string }> {
  // One login at a time: a new attempt supersedes any earlier helper.
  await Promise.all([...sessions.keys()].map(dispose));
  const stack = await discoverStack();
  const loginId = randomUUID();
  const container = await docker.createContainer({
    Image: options.image ?? stack.runnerImage,
    // Linger after claude exits so the credentials can still be read from the (tmpfs) HOME.
    Entrypoint: options.command?.entrypoint ?? ['sh', '-c'],
    Cmd: options.command?.cmd ?? [`claude auth login; sleep ${LINGER_SECONDS}`],
    User: '1000:1000',
    Tty: true,
    OpenStdin: true,
    Env: [`HOME=${HELPER_HOME}`, 'COLUMNS=500', 'LINES=50', 'TERM=xterm'],
    Labels: { [LOGIN_LABEL]: 'login', 'claudecloud.login-id': loginId },
    // Removed explicitly (not AutoRemove) so the credentials can still be read after claude exits.
    HostConfig: { Tmpfs: { [HELPER_HOME]: 'rw,uid=1000,gid=1000,mode=0700' } },
  });
  let session: LoginSession;
  try {
    const stream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as Duplex;
    session = newSession(loginId, container, stream);
  } catch (error) {
    await removeContainer(container);
    throw error;
  }
  sessions.set(loginId, session);
  optionsByLogin.set(loginId, options);
  try {
    await container.start();
    const url = await waitFor(options.timeouts?.url ?? URL_TIMEOUT_MS, () => {
      const found = extractLoginUrl(session.output);
      // The URL streams in chunks: wait for the code prompt (or for output to go quiet) before trusting it.
      if (found && (hasCodePrompt(session.output) || session.exited || Date.now() - session.lastDataAt > URL_SETTLE_MS)) {
        return found;
      }
      return session.exited ? '' : null;
    });
    if (!url) throw new Error('Claude did not print a login URL');
    return { loginId, url };
  } catch (error) {
    await dispose(loginId);
    throw error;
  }
}

/** Sends the pasted code and waits for the credentials file to appear (the authoritative success signal). */
export async function submitLoginCode(
  loginId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = sessions.get(loginId);
  if (!session) return { ok: false, message: 'This login has expired. Start again.' };
  const clean = validateLoginCode(code);
  if (!clean) return { ok: false, message: 'That does not look like a login code.' };
  const options = optionsByLogin.get(loginId) ?? {};
  const volume = options.volume ?? credentialsVolume();

  try {
    session.stream.write(`${clean}\r`);
    const found = await waitFor(options.timeouts?.success ?? SUCCESS_TIMEOUT_MS, async () => {
      const text = await readHelperCredentials(session.container);
      if (text && parseCredentials(text)) return text;
      // Exited or disposed (timer/cancel) without credentials: give up now instead of polling a dead helper.
      return session.exited || sessions.get(loginId) !== session ? '' : null;
    });
    if (!found) return { ok: false, message: 'Code rejected or login timed out. Start a new login.' };
    await volume.writeCredentialsAtomic(found);
    await volume.backupCredentials();
    return { ok: true };
  } finally {
    await dispose(loginId);
  }
}

export async function cancelLogin(loginId: string): Promise<void> {
  await dispose(loginId);
}
