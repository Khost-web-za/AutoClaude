'use client';

import { PagedComboBox } from '@/ui/paged-combo-box';
import { searchBranchOptions } from './new-session-actions';

/** The chosen repository's branches, searched and paged on the server. Disabled until a repository is picked. */
export function BranchPicker({
  repo,
  value,
  onChange,
  errorMessage,
}: {
  repo: string | null;
  value: string | null;
  onChange: (branch: string | null) => void;
  errorMessage?: string;
}) {
  return (
    <PagedComboBox
      // A different repository is a different list: start fresh.
      key={repo ?? 'none'}
      label="Base branch"
      placeholder={repo ? 'Search branches' : 'Pick a repository first'}
      value={value ? { id: value, label: value } : null}
      load={(query, page) => searchBranchOptions(repo, query, page)}
      onChange={(option) => onChange(option?.id ?? null)}
      errorMessage={errorMessage}
      isDisabled={!repo}
      description="The working branch is created from this."
    />
  );
}
