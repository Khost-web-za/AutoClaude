import { z } from 'zod';

/** `git check-ref-format --branch`, roughly: no leading `-`, no `..`, `//`, `@{`, control or special characters. */
export function isValidBranchName(value: string): boolean {
  return (
    /^[^\s~^:?*[\\\x00-\x1f\x7f]+$/.test(value) &&
    !/^[-/.]|\/$|\.$|\.\.|\/\/|@\{|\/\.|\.lock(\/|$)/.test(value) &&
    value !== '@'
  );
}

/** A branch name, or empty for "the repository default" (repository settings). */
export const optionalBranchNameSchema = z
  .string()
  .trim()
  .max(255, 'At most 255 characters')
  .refine((value) => value === '' || isValidBranchName(value), { message: 'Not a valid branch name' });

/** A branch name that must be given (New session's base branch). */
export const branchNameSchema = z
  .string()
  .trim()
  .min(1, 'Pick a base branch')
  .max(255, 'At most 255 characters')
  .refine(isValidBranchName, { message: 'Not a valid branch name' });
