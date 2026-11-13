import { z } from 'zod';

/** Environment-variable style: what the runner exports into the session. */
export const SECRET_KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;
export const SECRET_VALUE_MAX_BYTES = 32 * 1024;

export const secretKeySchema = z
  .string({ error: 'Enter a name' })
  .regex(SECRET_KEY_PATTERN, 'Use A–Z, 0–9 and _, starting with a letter or _ (at most 64)');

/** Multi-line is fine; the limit is in UTF-8 bytes. Messages never quote the value. */
export const secretValueSchema = z
  .string({ error: 'Enter a value' })
  .min(1, 'Enter a value')
  .refine((value) => new TextEncoder().encode(value).length <= SECRET_VALUE_MAX_BYTES, {
    message: 'At most 32 KB',
  });

/** The secret store ref of a repository secret: what the runner API reads back by `${repo}:` prefix. */
export const repoSecretRef = (repoFullName: string, key: string) => `${repoFullName}:${key}`;
export const repoSecretPrefix = (repoFullName: string) => `${repoFullName}:`;
