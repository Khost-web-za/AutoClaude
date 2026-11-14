import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StoreModule from '@/kickoffs/kickoff-store';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const revalidatePath = vi.fn();
const addKickoff = vi.fn();
const rescheduleKickoff = vi.fn();
const removeKickoff = vi.fn();
const getSettings = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/db/client', () => ({ db: {} }));
vi.mock('@/settings/settings-store', () => ({ getSettings }));
vi.mock('@/kickoffs/kickoff-store', async (importOriginal) => ({
  ...(await importOriginal<typeof StoreModule>()),
  addKickoff,
  rescheduleKickoff,
  removeKickoff,
}));

const { KickoffLimitError } = await import('@/kickoffs/kickoff-store');
const { addKickoffAction, removeKickoffAction, rescheduleKickoffAction } = await import('@/kickoffs/kickoff-actions');

const ZONE = 'America/New_York';
const ID = '3f0f2c64-4a2b-4a53-9a43-0f8a1d6c7e11';
const inHours = (hours: number) => instantToWallTime(new Date(Date.now() + hours * 3_600_000), ZONE);

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ timeZone: ZONE });
  addKickoff.mockImplementation(async (_db: unknown, runAt: Date) => ({
    id: ID,
    runAt,
    status: 'scheduled',
    outcome: null,
    windowResetsAt: null,
    createdAt: new Date(),
    finishedAt: null,
  }));
});

describe('addKickoffAction', () => {
  it('rejects without owner', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(addKickoffAction(inHours(2))).rejects.toThrow('403');
    expect(addKickoff).not.toHaveBeenCalled();
  });

  it('rejects a malformed value', async () => {
    expect(await addKickoffAction('tomorrow')).toEqual({ ok: false, error: 'Pick a date and time.' });
    expect(await addKickoffAction(42)).toMatchObject({ ok: false });
    expect(addKickoff).not.toHaveBeenCalled();
  });

  it('rejects a past time with the schema copy', async () => {
    expect(await addKickoffAction('2020-01-01T10:00')).toEqual({ ok: false, error: 'Pick a time in the future.' });
    expect(addKickoff).not.toHaveBeenCalled();
  });

  it('adds in the settings time zone', async () => {
    const local = inHours(5);
    const result = await addKickoffAction(local);
    expect(addKickoff).toHaveBeenCalledWith(expect.anything(), wallTimeToInstant(local, ZONE));
    expect(result).toMatchObject({
      ok: true,
      kickoff: { id: ID, runAt: wallTimeToInstant(local, ZONE).toISOString(), status: 'scheduled' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/schedule');
  });

  it('answers with the limit copy when 20 are already scheduled', async () => {
    addKickoff.mockRejectedValueOnce(new KickoffLimitError());
    expect(await addKickoffAction(inHours(2))).toEqual({
      ok: false,
      error: 'At most 20 kick-offs can be scheduled at once.',
    });
  });
});

describe('rescheduleKickoffAction', () => {
  it('rejects without owner', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(rescheduleKickoffAction(ID, inHours(2))).rejects.toThrow('403');
    expect(rescheduleKickoff).not.toHaveBeenCalled();
  });

  it('rejects a bad id and a past time', async () => {
    expect(await rescheduleKickoffAction('nope', inHours(2))).toMatchObject({ ok: false });
    expect(await rescheduleKickoffAction(ID, '2020-01-01T10:00')).toEqual({
      ok: false,
      error: 'Pick a time in the future.',
    });
    expect(rescheduleKickoff).not.toHaveBeenCalled();
  });

  it('moves a scheduled kick-off, and errors when it is no longer scheduled', async () => {
    const local = inHours(3);
    rescheduleKickoff.mockResolvedValueOnce(true);
    expect(await rescheduleKickoffAction(ID, local)).toEqual({ ok: true });
    expect(rescheduleKickoff).toHaveBeenCalledWith(expect.anything(), ID, wallTimeToInstant(local, ZONE));
    expect(revalidatePath).toHaveBeenCalledWith('/schedule');

    rescheduleKickoff.mockResolvedValueOnce(false);
    expect(await rescheduleKickoffAction(ID, local)).toMatchObject({ ok: false });
  });
});

describe('removeKickoffAction', () => {
  it('rejects without owner', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(removeKickoffAction(ID)).rejects.toThrow('403');
    expect(removeKickoff).not.toHaveBeenCalled();
  });

  it('removes a scheduled kick-off', async () => {
    removeKickoff.mockResolvedValueOnce(true);
    expect(await removeKickoffAction(ID)).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/schedule');
  });

  it('remove of a finished kick-off returns an error', async () => {
    removeKickoff.mockResolvedValueOnce(false);
    expect(await removeKickoffAction(ID)).toEqual({
      ok: false,
      error: 'That kick-off has already run or was removed.',
    });
  });

  it('rejects an id that is not a uuid', async () => {
    expect(await removeKickoffAction('x')).toMatchObject({ ok: false });
    expect(removeKickoff).not.toHaveBeenCalled();
  });
});
