import { describe, expect, it, vi } from 'vitest';
import type { SessionDocker } from '@/sessions/session-deps';
import { demuxDockerLog, readSessionLogs, redactLogLines } from '@/sessions/session-logs';
import { stripAnsi } from '@/claude/ansi';

const frame = (stream: 1 | 2, text: string) => {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
};

describe('stripAnsi', () => {
  it('removes colour, cursor and OSC sequences', () => {
    expect(stripAnsi('\u001b[1;32mok\u001b[0m \u001b[2K\u001b]0;title\u0007done')).toBe('ok done');
  });
});

describe('redactLogLines (R6)', () => {
  it('replaces every occurrence of a secret value on a line that also has ANSI codes', () => {
    const lines = ['\u001b[33mtoken=\u001b[0ms3cr3t-VALUE and again s3cr3t-VALUE\u001b[0m', 'clean line'];
    expect(redactLogLines(lines, ['s3cr3t-VALUE'])).toEqual(['token=•••• and again ••••', 'clean line']);
  });

  it('a secret split by an ANSI code is still found (strip first)', () => {
    expect(redactLogLines(['key s3cr\u001b[1m3t-VALUE end'], ['s3cr3t-VALUE'])).toEqual(['key •••• end']);
  });

  it('longer secrets win over secrets they contain, regex characters are literal, empty values are ignored', () => {
    expect(redactLogLines(['a.b+c a.b+c-long x'], ['a.b+c', 'a.b+c-long', ''])).toEqual(['•••• •••• x']);
    expect(redactLogLines(['axb'], ['a.b'])).toEqual(['axb']);
  });

  it('each line of a multi-line secret is redacted', () => {
    expect(redactLogLines(['-----BEGIN KEY-----', 'abcDEF123456', 'other'], ['-----BEGIN KEY-----\nabcDEF123456\n'])).toEqual([
      '••••',
      '••••',
      'other',
    ]);
  });
});

describe('demuxDockerLog', () => {
  it('joins stdout and stderr frames in order and splits lines', () => {
    const buffer = Buffer.concat([frame(1, 'one\ntw'), frame(2, 'o\nthree\n')]);
    expect(demuxDockerLog(buffer)).toEqual(['one', 'two', 'three']);
  });

  it('reads a TTY (raw) log as plain text', () => {
    expect(demuxDockerLog(Buffer.from('plain\r\ntext\n'))).toEqual(['plain', 'text']);
  });
});

describe('readSessionLogs', () => {
  it("asks the store for the session's own canonical repo prefix and redacts with what comes back", async () => {
    const getMany = vi.fn(
      async (_kind: string, prefix: string): Promise<Record<string, string>> =>
        prefix === 'Acme/Widgets:' ? { 'Acme/Widgets:API_TOKEN': 'sup3r-s3cret' } : {},
    );
    const logs = vi.fn(async () => frame(1, '\u001b[33mtoken=\u001b[0msup3r-s3cret\n'));
    const docker = { getContainer: () => ({ logs }) } as unknown as SessionDocker;
    const result = await readSessionLogs({ containerId: 'c1', repoFullName: 'Acme/Widgets' }, { docker, secretStore: { getMany } });
    expect(getMany).toHaveBeenCalledWith('repo', 'Acme/Widgets:');
    expect(result).toEqual({ ok: true, lines: ['token=••••'] });
    expect(logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 500, stdout: true, stderr: true }));
  });

  it('a session without a container reads no secrets at all', async () => {
    const getMany = vi.fn();
    const docker = { getContainer: vi.fn() } as unknown as SessionDocker;
    const result = await readSessionLogs({ containerId: null, repoFullName: 'Acme/Widgets' }, { docker, secretStore: { getMany } });
    expect(result.ok).toBe(false);
    expect(getMany).not.toHaveBeenCalled();
  });
});
