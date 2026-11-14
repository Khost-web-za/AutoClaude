import { z } from 'zod';

export const RESUME_MESSAGE_MAX = 500;

/** What auto-resume types into Claude: trimmed, never empty, at most {@link RESUME_MESSAGE_MAX} characters. */
export const resumeMessageSchema = z
  .string()
  .trim()
  .min(1, 'Enter a message to send when the session resumes')
  .max(RESUME_MESSAGE_MAX, `At most ${RESUME_MESSAGE_MAX} characters`);
