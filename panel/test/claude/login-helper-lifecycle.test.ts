import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const remove = vi.fn(async (..._args: unknown[]) => undefined);
const attach = vi.fn(async (): Promise<unknown> => {
  throw new Error('attach boom');
});
type FakeContainer = { attach: () => Promise<unknown>; remove: () => unknown; start: () => Promise<unknown> };
const createContainer = vi.fn(
  async (): Promise<FakeContainer> => ({ attach, remove: () => remove('created'), start: async () => undefined }),
);
const listContainers = vi.fn(async () => [{ Id: 'a1' }, { Id: 'b2' }]);
const getContainer = vi.fn((id: string) => ({ id, remove: async (o: unknown) => remove(id, o) }));

vi.mock('@/docker/docker-client', () => ({ docker: { createContainer, listContainers, getContainer } }));
vi.mock('@/docker/self-discovery', () => ({
  discoverStack: async () => ({ networkName: 'n', claudeAuthVolume: 'v', runnerImage: 'img' }),
}));

beforeEach(() => vi.clearAllMocks());

describe('login helper lifecycle', () => {
  it('removes the container when attach fails after create', async () => {
    const { startLogin } = await import('@/claude/login-helper');
    await expect(startLogin()).rejects.toThrow('attach boom');
    expect(remove).toHaveBeenCalledWith('created');
  });

  it('boot sweep force-removes every labelled helper', async () => {
    const { removeStaleLoginHelpers } = await import('@/claude/login-helper');
    expect(await removeStaleLoginHelpers()).toBe(2);
    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: ['claudecloud.role=login'] },
    });
    expect(remove.mock.calls.map((c) => c[0])).toEqual(['a1', 'b2']);
  });

  it('sends the login code terminated by CR (0x0D), never LF', async () => {
    const stream = new PassThrough();
    const written: Buffer[] = [];
    stream.on('data', () => undefined);
    const realWrite = stream.write.bind(stream);
    stream.write = ((chunk: string | Buffer, ...rest: unknown[]) => {
      written.push(Buffer.from(chunk));
      return (realWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    createContainer.mockResolvedValueOnce({
      attach: async () => stream,
      remove: () => remove('created'),
      start: async () => {
        const url = 'https://claude.com/cai/oauth/authorize?client_id=x&state=y';
        setImmediate(() => stream.emit('data', Buffer.from(`visit: ${url}\r\nPaste code here if prompted > `)));
      },
    });
    const { startLogin, submitLoginCode } = await import('@/claude/login-helper');
    const { loginId } = await startLogin({ timeouts: { url: 5000, success: 1 } });
    const result = await submitLoginCode(loginId, ' abc#123 ');
    expect(result.ok).toBe(false);
    const bytes = Buffer.concat(written);
    expect(bytes.toString('latin1')).toBe('abc#123\r');
    expect(bytes.at(-1)).toBe(0x0d);
    expect(bytes.includes(0x0a)).toBe(false);
  });
});
