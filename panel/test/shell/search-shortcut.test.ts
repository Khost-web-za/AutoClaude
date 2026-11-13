import { describe, expect, it } from 'vitest';
import { shouldFocusSearch } from '@/shell/search-shortcut';

const base = { key: '/', metaKey: false, ctrlKey: false, altKey: false };

describe('shouldFocusSearch', () => {
  it('fires for a bare slash on the page', () => {
    expect(shouldFocusSearch({ ...base, target: { tagName: 'BODY' } })).toBe(true);
  });
  it.each(['INPUT', 'textarea', 'SELECT'])('ignores slash typed in %s', (tagName) => {
    expect(shouldFocusSearch({ ...base, target: { tagName } })).toBe(false);
  });
  it('ignores editable regions and modified keys', () => {
    expect(shouldFocusSearch({ ...base, target: { isContentEditable: true } })).toBe(false);
    expect(shouldFocusSearch({ ...base, ctrlKey: true, target: null })).toBe(false);
  });
});
