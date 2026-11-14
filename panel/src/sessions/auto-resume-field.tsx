'use client';

import { Label, Switch } from '@heroui/react';

/**
 * Auto-resume switch, shared by repository settings and New session. In a native form it submits
 * `name=on` while on and nothing while off.
 */
export function AutoResumeField({
  isSelected,
  onChange,
  name,
}: {
  isSelected: boolean;
  onChange: (value: boolean) => void;
  name?: string;
}) {
  return (
    <Switch name={name} value="on" isSelected={isSelected} onChange={onChange} className="flex w-fit">
      <Switch.Content className="flex cursor-pointer items-start gap-3">
        <Switch.Control className="mt-0.5 shrink-0">
          <Switch.Thumb />
        </Switch.Control>
        <span className="flex min-w-0 flex-col gap-1">
          <Label className="font-semibold text-white">Auto-resume after a usage limit</Label>
          <span className="text-xs text-muted">
            When Claude hits its usage limit, type a message into the session once the limit resets.
          </span>
        </span>
      </Switch.Content>
    </Switch>
  );
}
