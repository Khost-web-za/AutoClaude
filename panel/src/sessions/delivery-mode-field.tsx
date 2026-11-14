'use client';

import { Label, Radio, RadioGroup } from '@heroui/react';
import type { DeliveryMode } from '@/db/schema';

const OPTIONS: readonly { value: DeliveryMode; label: string; description: string }[] = [
  { value: 'pull_request', label: 'Pull request', description: 'Work on a new claude/… branch and open a pull request' },
  {
    value: 'push',
    label: 'Push to branch',
    description: 'Work directly on the chosen branch and push to it. One session per branch at a time.',
  },
];

const isDeliveryMode = (value: string): value is DeliveryMode => OPTIONS.some((option) => option.value === value);

/** Session delivery choice, shared by repository settings and New session. Submitted as `deliveryMode` in a native form. */
export function DeliveryModeField({
  value,
  onChange,
  name,
  errorMessage,
}: {
  value: DeliveryMode;
  onChange: (value: DeliveryMode) => void;
  name?: string;
  errorMessage?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        name={name}
        value={value}
        onChange={(next) => {
          if (isDeliveryMode(next)) onChange(next);
        }}
        aria-label="Session delivery"
        isInvalid={Boolean(errorMessage)}
        className="grid gap-3 sm:grid-cols-2"
      >
        {OPTIONS.map((option) => (
          <Radio key={option.value} value={option.value} className="flex">
            <Radio.Content className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 transition-colors data-selected:border-accent/50 data-selected:bg-accent-soft motion-reduce:transition-none">
              <Radio.Control className="mt-0.5 shrink-0">
                <Radio.Indicator />
              </Radio.Control>
              <span className="flex min-w-0 flex-col gap-1">
                <Label className="font-semibold text-white">{option.label}</Label>
                <span className="text-xs text-muted">{option.description}</span>
              </span>
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
      {errorMessage ? <p className="text-sm text-danger">{errorMessage}</p> : null}
    </div>
  );
}
