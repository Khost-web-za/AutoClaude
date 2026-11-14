import { z } from 'zod';

const SLACK_MS = 60_000;
const MAX_AHEAD_MS = 7 * 24 * 60 * 60_000;

export const kickoffInputSchema = z.object({
  runAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and time.')
    .refine((value) => !Number.isNaN(Date.parse(`${value}:00Z`)), 'Pick a date and time.'),
});
export type KickoffInput = z.infer<typeof kickoffInputSchema>;

/** The error to show for a kick-off time, or null when it is acceptable (60 s of slack for the form being open). */
export function validateRunAt(runAt: Date, now: Date): string | null {
  const ahead = runAt.getTime() - now.getTime();
  if (ahead < -SLACK_MS) return 'Pick a time in the future.';
  if (ahead > MAX_AHEAD_MS) return 'Pick a time within the next 7 days.';
  return null;
}
