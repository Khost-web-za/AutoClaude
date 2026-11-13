import { describe, expect, it } from 'vitest';
import { parseSettingsForm, timeZoneOptions } from '@/settings/settings-schemas';

/** A valid form submission (every value a string, as FormData delivers it). */
const VALID = {
  maxRunning: '3',
  cpuPerSession: '4',
  memoryGbPerSession: '8',
  diskGbPerSession: '40',
  minFreeDiskGb: '10',
  usageResetDisplay: 'countdown',
  usageWarnPct: '80',
  usageDangerPct: '95',
  timeZone: 'Europe/Berlin',
};

const fieldErrors = (input: Record<string, string>) => {
  const result = parseSettingsForm(input);
  return result.success ? {} : result.fieldErrors;
};

describe('parseSettingsForm', () => {
  it('accepts the defaults and coerces numbers', () => {
    const result = parseSettingsForm(VALID);
    expect(result).toEqual({
      success: true,
      data: {
        maxRunning: 3,
        cpuPerSession: 4,
        memoryGbPerSession: 8,
        diskGbPerSession: 40,
        minFreeDiskGb: 10,
        usageResetDisplay: 'countdown',
        usageWarnPct: 80,
        usageDangerPct: 95,
        timeZone: 'Europe/Berlin',
      },
    });
  });

  it('accepts half a CPU and the range edges', () => {
    const result = parseSettingsForm({
      ...VALID,
      maxRunning: '20',
      cpuPerSession: '0.5',
      memoryGbPerSession: '128',
      diskGbPerSession: '5',
      minFreeDiskGb: '1000',
      usageWarnPct: '1',
      usageDangerPct: '100',
    });
    expect(result.success).toBe(true);
  });

  it('rejects max_running 0 and above 20', () => {
    expect(fieldErrors({ ...VALID, maxRunning: '0' })).toHaveProperty('maxRunning');
    expect(fieldErrors({ ...VALID, maxRunning: '21' })).toHaveProperty('maxRunning');
    expect(fieldErrors({ ...VALID, maxRunning: '2.5' })).toHaveProperty('maxRunning');
  });

  it('rejects resources outside their ranges', () => {
    expect(fieldErrors({ ...VALID, cpuPerSession: '0.25' })).toHaveProperty('cpuPerSession');
    expect(fieldErrors({ ...VALID, cpuPerSession: '33' })).toHaveProperty('cpuPerSession');
    expect(fieldErrors({ ...VALID, memoryGbPerSession: '0' })).toHaveProperty('memoryGbPerSession');
    expect(fieldErrors({ ...VALID, diskGbPerSession: '4' })).toHaveProperty('diskGbPerSession');
    expect(fieldErrors({ ...VALID, minFreeDiskGb: '1001' })).toHaveProperty('minFreeDiskGb');
    expect(fieldErrors({ ...VALID, memoryGbPerSession: '' })).toHaveProperty('memoryGbPerSession');
  });

  it('rejects warn >= danger on the danger field', () => {
    expect(fieldErrors({ ...VALID, usageWarnPct: '95', usageDangerPct: '95' })).toHaveProperty('usageDangerPct');
    expect(fieldErrors({ ...VALID, usageWarnPct: '96', usageDangerPct: '95' })).toHaveProperty('usageDangerPct');
    expect(fieldErrors({ ...VALID, usageWarnPct: '0' })).toHaveProperty('usageWarnPct');
    expect(fieldErrors({ ...VALID, usageDangerPct: '101' })).toHaveProperty('usageDangerPct');
  });

  it('rejects an unknown time zone and an unknown reset display', () => {
    expect(fieldErrors({ ...VALID, timeZone: 'Mars/Olympus_Mons' })).toHaveProperty('timeZone');
    expect(fieldErrors({ ...VALID, timeZone: '' })).toHaveProperty('timeZone');
    expect(fieldErrors({ ...VALID, usageResetDisplay: 'sundial' })).toHaveProperty('usageResetDisplay');
  });

  it('accepts UTC and stores the canonical spelling of a zone', () => {
    const utc = parseSettingsForm({ ...VALID, timeZone: 'UTC' });
    expect(utc.success && utc.data.timeZone).toBe('UTC');
    const lower = parseSettingsForm({ ...VALID, timeZone: 'europe/berlin' });
    expect(lower.success && lower.data.timeZone).toBe('Europe/Berlin');
  });
});

describe('timeZoneOptions', () => {
  it('lists UTC first and includes the IANA zones', () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Europe/Berlin');
    expect(new Set(zones).size).toBe(zones.length);
  });
});
