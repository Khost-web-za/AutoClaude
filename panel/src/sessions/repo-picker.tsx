'use client';

import { PagedComboBox, type PagedOption } from '@/ui/paged-combo-box';
import { searchRepoOptions } from './new-session-actions';

/** Repositories the GitHub App can see, searched and paged on the server. */
export function RepoPicker({
  value,
  onChange,
  errorMessage,
}: {
  value: PagedOption | null;
  onChange: (repo: PagedOption | null) => void;
  errorMessage?: string;
}) {
  return (
    <PagedComboBox
      label="Repository"
      placeholder="Search repositories"
      value={value}
      load={searchRepoOptions}
      onChange={onChange}
      errorMessage={errorMessage}
      emptyText="No repository matches. Is the App installed on it?"
    />
  );
}
