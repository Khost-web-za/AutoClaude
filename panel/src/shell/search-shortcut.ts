const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True only for a bare `/` pressed outside any input, textarea, select or editable region. */
export function shouldFocusSearch(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}): boolean {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false;
  const { target } = event;
  if (!target) return true;
  if (target.isContentEditable) return false;
  return !(target.tagName && EDITABLE_TAGS.has(target.tagName.toUpperCase()));
}
