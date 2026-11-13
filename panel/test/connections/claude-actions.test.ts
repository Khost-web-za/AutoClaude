import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoginHelper from '@/claude/login-helper';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const submitLoginCode = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/claude/login-helper', async (importOriginal) => {
  const actual = await importOriginal<typeof LoginHelper>();
  return {
    validateLoginCode: actual.validateLoginCode,
    startLogin: vi.fn(),
    cancelLogin: vi.fn(),
    submitLoginCode,
  };
});

const { finishClaudeLogin } = await import('@/connections/claude-actions');

const LOGIN_ID = '0b7f3c52-8a51-4b1d-9a3e-2f0c3d4e5f60';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('finishClaudeLogin', () => {
  it('checks the owner before anything else', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(finishClaudeLogin(LOGIN_ID, 'code#123')).rejects.toThrow('403');
    expect(submitLoginCode).not.toHaveBeenCalled();
  });

  it('keeps the helper alive for an obviously bad code, so the owner can paste again', async () => {
    expect(await finishClaudeLogin(LOGIN_ID, '   ')).toEqual({ ok: false, retry: true, message: expect.any(String) });
    expect(await finishClaudeLogin(LOGIN_ID, 'a\u0007b')).toMatchObject({ ok: false, retry: true });
    expect(submitLoginCode).not.toHaveBeenCalled();
  });

  it('asks for a new login when the helper is gone (lost login session)', async () => {
    submitLoginCode.mockResolvedValueOnce({ ok: false, message: 'This login has expired. Start again.' });
    expect(await finishClaudeLogin(LOGIN_ID, 'code#123')).toEqual({
      ok: false,
      retry: false,
      message: 'This login has expired. Start again.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a login id that is not a uuid without calling the helper', async () => {
    expect(await finishClaudeLogin('../etc', 'code#123')).toMatchObject({ ok: false, retry: false });
    expect(submitLoginCode).not.toHaveBeenCalled();
  });

  it('refreshes every page once connected', async () => {
    submitLoginCode.mockResolvedValueOnce({ ok: true });
    expect(await finishClaudeLogin(LOGIN_ID, ' code#123 ')).toEqual({ ok: true });
    expect(submitLoginCode).toHaveBeenCalledWith(LOGIN_ID, 'code#123');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('turns a helper crash into a fixed message', async () => {
    submitLoginCode.mockRejectedValueOnce(new Error('docker exploded with token sk-ant-xyz'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await finishClaudeLogin(LOGIN_ID, 'code#123');
    expect(result).toMatchObject({ ok: false, retry: false });
    expect(JSON.stringify(result)).not.toContain('sk-ant');
  });
});
