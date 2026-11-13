import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOwner = vi.fn(async () => ({ email: 'owner@example.com' }));
const saveSettings = vi.fn(async () => undefined);
const revalidatePath = vi.fn();

vi.mock('@/auth/require-owner', () => ({ requireOwner }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/settings/settings-store', () => ({ saveSettings }));

const { updateSettings } = await import('@/settings/settings-actions');

const VALID: Record<string, string> = {
  maxRunning: '3',
  cpuPerSession: '4',
  memoryGbPerSession: '8',
  diskGbPerSession: '40',
  minFreeDiskGb: '10',
  usageResetDisplay: 'clock',
  usageWarnPct: '80',
  usageDangerPct: '95',
  timeZone: 'Europe/Berlin',
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  // React adds `$ACTION_...` entries to action submissions; they must be ignored.
  data.set('$ACTION_ID_abc', '');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateSettings', () => {
  it('checks the owner before reading the form', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(updateSettings({ status: 'idle' }, form(VALID))).rejects.toThrow('403');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('saves validated, coerced values and refreshes the layout', async () => {
    expect(await updateSettings({ status: 'idle' }, form(VALID))).toEqual({ status: 'success', message: 'Settings saved.' });
    expect(saveSettings).toHaveBeenCalledWith({
      maxRunning: 3,
      cpuPerSession: 4,
      memoryGbPerSession: 8,
      diskGbPerSession: 40,
      minFreeDiskGb: 10,
      usageResetDisplay: 'clock',
      usageWarnPct: 80,
      usageDangerPct: 95,
      timeZone: 'Europe/Berlin',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('never saves an invalid submission, whatever the browser allowed', async () => {
    const result = await updateSettings({ status: 'idle' }, form({ ...VALID, maxRunning: '0', usageWarnPct: '99' }));
    expect(result).toMatchObject({ status: 'error' });
    expect(result.status === 'error' && Object.keys(result.fieldErrors ?? {})).toEqual(['maxRunning', 'usageDangerPct']);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
