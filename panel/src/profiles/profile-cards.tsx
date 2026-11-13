'use client';

import { Checkbox, CheckboxGroup, Label } from '@heroui/react';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import type { Profile } from './profile-catalog';
import { ProfileContents } from './profile-contents';

export interface ProfileCardsProps {
  profiles: readonly Profile[];
  /** Controlled selection (locked profiles are always added). Leave out to use `defaultSelected`. */
  selected?: readonly string[];
  defaultSelected?: readonly string[];
  onChange?: (selected: string[]) => void;
  /** Form field name: each ticked profile is submitted as one `name` entry. */
  name?: string;
  label?: string;
  isInvalid?: boolean;
}

const withLocked = (profiles: readonly Profile[], names: readonly string[]) => [
  ...new Set([...profiles.filter((profile) => profile.locked).map((profile) => profile.name), ...names]),
];

/**
 * One tick card per config profile (name, description, what it contains). Locked profiles (base)
 * are always ticked and cannot be unticked. Shared by repository settings and New session.
 */
export function ProfileCards({
  profiles,
  selected,
  defaultSelected = [],
  onChange,
  name,
  label = 'Config profiles',
  isInvalid,
}: ProfileCardsProps) {
  const [own, setOwn] = useState<string[]>(() => withLocked(profiles, defaultSelected));
  const value = selected ? withLocked(profiles, selected) : own;

  function change(next: string[]) {
    const complete = withLocked(profiles, next);
    if (!selected) setOwn(complete);
    onChange?.(complete);
  }

  return (
    <CheckboxGroup
      name={name}
      value={value}
      onChange={change}
      aria-label={label}
      isInvalid={isInvalid}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {profiles.map((profile) => (
        <Checkbox key={profile.name} value={profile.name} isReadOnly={profile.locked} className="flex">
          <Checkbox.Content className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 transition-colors data-selected:border-accent/50 data-selected:bg-accent-soft data-readonly:cursor-default motion-reduce:transition-none">
            <Checkbox.Control className="mt-0.5 shrink-0">
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span className="flex min-w-0 flex-col gap-1">
              <Label className="inline-flex items-center gap-1.5 font-semibold text-white">
                {profile.name}
                {profile.locked ? <Lock aria-label="always loaded" className="size-3 opacity-60" /> : null}
              </Label>
              <span className="text-xs text-muted">
                {profile.locked ? 'Always loaded' : (profile.description ?? 'No description')}
                {profile.locked && profile.description ? ` · ${profile.description}` : null}
              </span>
              <ProfileContents profile={profile} />
            </span>
          </Checkbox.Content>
        </Checkbox>
      ))}
    </CheckboxGroup>
  );
}
