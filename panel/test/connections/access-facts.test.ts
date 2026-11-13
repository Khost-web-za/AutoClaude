import { describe, expect, it } from 'vitest';
import { maskAud } from '@/connections/access-facts';

describe('maskAud', () => {
  it('keeps the first and last four characters', () => {
    expect(maskAud('abcd0123456789wxyz')).toBe('abcd…wxyz');
  });

  it('hides a value too short to mask safely', () => {
    expect(maskAud('abcdwxyz')).toBe('••••');
    expect(maskAud('  ')).toBe('••••');
  });
});
