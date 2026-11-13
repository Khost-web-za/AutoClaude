import { describe, expect, it } from 'vitest';
import { paginateArray, parsePageParam } from '@/db/pagination';

describe('parsePageParam', () => {
  it.each([
    ['3', 3],
    ['0', 1],
    ['-4', 1],
    ['abc', 1],
    ['2.7', 2],
    [['2', '5'], 2],
    [undefined, 1],
    ['', 1],
  ] as const)('%j -> %i', (input, expected) => {
    expect(parsePageParam(input as string | string[] | undefined)).toBe(expected);
  });
});

describe('paginateArray', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  it('slices pages of 20 and clamps past the end to the last page', () => {
    expect(paginateArray(items, 1)).toMatchObject({ page: 1, pageCount: 3, total: 45, pageSize: 20 });
    expect(paginateArray(items, 3).items).toEqual([40, 41, 42, 43, 44]);
    expect(paginateArray(items, 9).page).toBe(3);
    expect(paginateArray(items, 0).page).toBe(1);
  });

  it('has one empty page for an empty list', () => {
    expect(paginateArray([], 2)).toEqual({ items: [], page: 1, pageSize: 20, total: 0, pageCount: 1 });
  });
});
