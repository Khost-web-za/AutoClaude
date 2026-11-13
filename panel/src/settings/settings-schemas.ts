import { z } from 'zod';
import { usageResetDisplays } from '@/db/schema';

/** The canonical IANA name of a zone (`europe/berlin` -> `Europe/Berlin`), or null when the runtime does not know it. */
function canonicalTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Every zone the Settings picker offers: UTC first, then the runtime's IANA list. */
export function timeZoneOptions(): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
}

/** FormData sends strings; an empty field must fail as "required", not coerce to 0. */
const numberField = (min: number, max: number, { integer = true } = {}) => {
  const base = z.number({ error: 'Enter a number' }).min(min, `At least ${min}`).max(max, `At most ${max}`);
  return z.preprocess(
    (value) => (typeof value === 'string' ? (value.trim() === '' ? undefined : Number(value)) : value),
    integer ? base.int('Whole numbers only') : base,
  );
};

export const settingsSchema = z
  .object({
    maxRunning: numberField(1, 20),
    cpuPerSession: numberField(0.5, 32, { integer: false }),
    memoryGbPerSession: numberField(1, 128),
    diskGbPerSession: numberField(5, 500),
    minFreeDiskGb: numberField(1, 1000),
    usageResetDisplay: z.enum(usageResetDisplays, { error: 'Choose countdown or clock' }),
    usageWarnPct: numberField(1, 100),
    usageDangerPct: numberField(1, 100),
    timeZone: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const zone = value ? canonicalTimeZone(value) : null;
        if (!zone) {
          ctx.addIssue({ code: 'custom', message: 'Unknown time zone' });
          return z.NEVER;
        }
        return zone;
      }),
  })
  .refine((value) => value.usageWarnPct < value.usageDangerPct, {
    path: ['usageDangerPct'],
    message: 'Must be higher than the warning level',
  });

export type SettingsInput = z.infer<typeof settingsSchema>;

export type SettingsParseResult =
  | { success: true; data: SettingsInput }
  | { success: false; fieldErrors: Record<string, string[]> };

/** Validates a Settings form submission (FormData entries or a plain record). */
export function parseSettingsForm(input: Record<string, unknown>): SettingsParseResult {
  const result = settingsSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { success: false, fieldErrors };
}
