'use client';

import { Collection, ComboBox, Description, FieldError, Input, Label, ListBox, ListBoxLoadMoreItem, Spinner } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

export type PagedOption = { id: string; label: string; detail?: string };
export type PagedOptions = { ok: true; items: PagedOption[]; page: number; pageCount: number } | { ok: false; message: string };

const SEARCH_DEBOUNCE_MS = 250;

/**
 * A combo box over a server-searched, server-paginated list: typing searches (debounced), scrolling to
 * the end of the menu loads the next page. `load` is a server action; only the chosen option leaves it.
 */
export function PagedComboBox({
  label,
  placeholder,
  value,
  load,
  onChange,
  description,
  errorMessage,
  isDisabled,
  emptyText = 'No matches',
}: {
  label: string;
  placeholder?: string;
  /** The chosen option (controlled). */
  value: PagedOption | null;
  load: (query: string, page: number) => Promise<PagedOptions>;
  onChange: (option: PagedOption | null) => void;
  description?: string;
  errorMessage?: string;
  isDisabled?: boolean;
  emptyText?: string;
}) {
  const [input, setInput] = useState(value?.label ?? '');
  const [items, setItems] = useState<PagedOption[]>(value ? [value] : []);
  const [paging, setPaging] = useState({ page: 0, pageCount: 1 });
  const [loading, setLoading] = useState<'idle' | 'search' | 'more'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  // A new value from outside (another repo picked → branch reset) shows as the input text.
  const [shownValue, setShownValue] = useState(value);
  if (shownValue?.id !== value?.id) {
    setShownValue(value);
    setInput(value?.label ?? '');
    if (value && !items.some((item) => item.id === value.id)) setItems([value, ...items]);
  }

  async function fetchPage(query: string, page: number) {
    const ticket = ++request.current;
    setLoading(page === 1 ? 'search' : 'more');
    try {
      const result = await loadRef.current(query, page);
      if (ticket !== request.current) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      setItems((current) => (page === 1 ? result.items : [...current, ...result.items.filter((i) => !current.some((c) => c.id === i.id))]));
      setPaging({ page: result.page, pageCount: result.pageCount });
    } catch {
      if (ticket === request.current) setLoadError('The panel could not be reached. Try again.');
    } finally {
      if (ticket === request.current) setLoading('idle');
    }
  }

  function search(text: string) {
    // Picking an option writes its label into the input: that is not a new search.
    const query = value && text === value.label ? '' : text.trim();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetchPage(query, 1), SEARCH_DEBOUNCE_MS);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ComboBox
      items={items}
      inputValue={input}
      onInputChange={(text) => {
        setInput(text);
        search(text);
      }}
      selectedKey={value?.id ?? null}
      onSelectionChange={(key) => {
        const option = items.find((item) => item.id === key) ?? null;
        onChange(option);
      }}
      onOpenChange={(open) => {
        if (open && paging.page === 0) void fetchPage('', 1);
      }}
      allowsEmptyCollection
      menuTrigger="focus"
      isDisabled={isDisabled}
      isInvalid={Boolean(errorMessage)}
      className="flex min-w-0 flex-col gap-2"
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={placeholder} className="min-h-11" spellCheck={false} />
        {loading === 'search' ? <Spinner size="sm" className="mr-2" /> : null}
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
      <ComboBox.Popover>
        <ListBox
          renderEmptyState={() => (
            <p className="px-3 py-2 text-sm text-muted">{loadError ?? (loading === 'idle' ? emptyText : 'Loading…')}</p>
          )}
        >
          <Collection items={items}>
            {(item: PagedOption) => (
              <ListBox.Item id={item.id} textValue={item.label}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.detail ? <span className="truncate text-xs text-text-subtle">{item.detail}</span> : null}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </Collection>
          {paging.page > 0 && paging.page < paging.pageCount ? (
            <ListBoxLoadMoreItem
              onLoadMore={() => {
                if (loading === 'idle') void fetchPage(value && input === value.label ? '' : input.trim(), paging.page + 1);
              }}
              isLoading={loading === 'more'}
            >
              <span className="flex justify-center py-2">
                <Spinner size="sm" />
              </span>
            </ListBoxLoadMoreItem>
          ) : null}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
