import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ResumeNowModule from '@/auto-resume/resume-now';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const resumeNow = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/auto-resume/resume-now', async (importOriginal) => ({
  ...(await importOriginal<typeof ResumeNowModule>()),
  resumeNow,
}));

const { resumeNowAction } = await import('@/auto-resume/resume-actions');
const { ResumeNotApplicableError } = await import('@/auto-resume/resume-now');
const { SessionNotFoundError } = await import('@/sessions/session-record');

const SESSION_ID = '0b5c2a3e-1f2d-4c5b-8a9e-0123456789ab';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resumeNowAction', () => {
  it('requires the owner before anything else', async () => {
    requireOwner.mockRejectedValueOnce(new Error('redirect'));
    await expect(resumeNowAction(SESSION_ID)).rejects.toThrow('redirect');
    expect(resumeNow).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a session id', async () => {
    expect(await resumeNowAction('nope')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await resumeNowAction(42)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(resumeNow).not.toHaveBeenCalled();
  });

  it('queues the resume and revalidates', async () => {
    resumeNow.mockResolvedValue(undefined);
    expect(await resumeNowAction(SESSION_ID)).toEqual({ ok: true, message: 'Resuming within 30 seconds.' });
    expect(resumeNow).toHaveBeenCalledWith(SESSION_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('explains when there is nothing to resume', async () => {
    resumeNow.mockRejectedValue(new ResumeNotApplicableError());
    expect(await resumeNowAction(SESSION_ID)).toMatchObject({ ok: false, reason: 'blocked' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports an unknown session', async () => {
    resumeNow.mockRejectedValue(new SessionNotFoundError(SESSION_ID));
    expect(await resumeNowAction(SESSION_ID)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('turns anything else into an unavailable result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resumeNow.mockRejectedValue(new Error('db down'));
    expect(await resumeNowAction(SESSION_ID)).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
