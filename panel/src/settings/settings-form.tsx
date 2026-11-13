'use client';

import {
  Button,
  ComboBox,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from '@heroui/react';
import { useActionState, useState } from 'react';
import { IDLE_FORM, type FormAction } from '@/feedback/form-state';
import { submitWithoutReset } from '@/feedback/form-submit';
import { withToast } from '@/feedback/toast-host';
import { SectionLabel } from '@/ui/section-label';
import type { Settings } from './settings-store';

type NumberKey = Exclude<keyof Settings, 'usageResetDisplay' | 'timeZone'>;

const NUMBER_FIELDS: Record<
  NumberKey,
  { label: string; description: string; min: number; max: number; step: number; unit?: string }
> = {
  maxRunning: { label: 'Running sessions', description: 'Start refuses beyond this many (1 to 20).', min: 1, max: 20, step: 1 },
  cpuPerSession: { label: 'CPU per session', description: 'Cores, 0.5 to 32.', min: 0.5, max: 32, step: 0.5, unit: 'cores' },
  memoryGbPerSession: { label: 'Memory per session', description: '1 to 128 GB.', min: 1, max: 128, step: 1, unit: 'GB' },
  diskGbPerSession: { label: 'Disk per session', description: '5 to 500 GB.', min: 5, max: 500, step: 1, unit: 'GB' },
  minFreeDiskGb: {
    label: 'Minimum free host disk',
    description: 'Start refuses below this (1 to 1000 GB).',
    min: 1,
    max: 1000,
    step: 1,
    unit: 'GB',
  },
  usageWarnPct: { label: 'Warn at', description: 'Usage bars turn amber (1 to 100 %).', min: 1, max: 100, step: 1, unit: '%' },
  usageDangerPct: {
    label: 'Danger at',
    description: 'Usage bars turn red. Must be above the warning level.',
    min: 1,
    max: 100,
    step: 1,
    unit: '%',
  },
};

const RESET_DISPLAYS = [
  { id: 'countdown', label: 'Countdown ("in 2h 14m")' },
  { id: 'clock', label: 'Clock time ("at 2:37 PM")' },
] as const;

function NumberSetting({
  name,
  value,
  onChange,
}: {
  name: NumberKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const field = NUMBER_FIELDS[name];
  return (
    <TextField name={name} value={value} onChange={onChange} isRequired className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          inputMode="decimal"
          min={field.min}
          max={field.max}
          step={field.step}
          className="min-h-11 w-32 font-mono tabular-nums"
        />
        {field.unit ? <span className="text-sm text-muted">{field.unit}</span> : null}
      </div>
      <Description>{field.description}</Description>
      <FieldError />
    </TextField>
  );
}

/** The Settings form. Controlled and dispatched from onSubmit, so the fields keep what was typed after a save or a rejection. */
export function SettingsForm({
  settings,
  timeZones,
  action,
}: {
  settings: Settings;
  timeZones: readonly string[];
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(withToast(action), IDLE_FORM);
  const [values, setValues] = useState(() => ({
    ...(Object.fromEntries(
      (Object.keys(NUMBER_FIELDS) as NumberKey[]).map((key) => [key, String(settings[key])]),
    ) as Record<NumberKey, string>),
    usageResetDisplay: settings.usageResetDisplay as string,
    timeZone: settings.timeZone,
  }));
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const zoneItems = timeZones.map((zone) => ({ id: zone }));

  return (
    <Form onSubmit={submitWithoutReset(formAction)} validationErrors={fieldErrors} className="flex max-w-3xl flex-col gap-12">
      <section className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
        <SectionLabel className="sm:col-span-2">Sessions</SectionLabel>
        <NumberSetting name="maxRunning" value={values.maxRunning} onChange={set('maxRunning')} />
        <NumberSetting name="minFreeDiskGb" value={values.minFreeDiskGb} onChange={set('minFreeDiskGb')} />
        <NumberSetting name="cpuPerSession" value={values.cpuPerSession} onChange={set('cpuPerSession')} />
        <NumberSetting name="memoryGbPerSession" value={values.memoryGbPerSession} onChange={set('memoryGbPerSession')} />
        <NumberSetting name="diskGbPerSession" value={values.diskGbPerSession} onChange={set('diskGbPerSession')} />
        <p className="text-sm text-muted sm:col-span-2">
          Resource limits apply to sessions started from now on. Running sessions keep theirs.
        </p>
      </section>

      <section className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
        <SectionLabel className="sm:col-span-2">Usage display</SectionLabel>
        <Select
          name="usageResetDisplay"
          selectedKey={values.usageResetDisplay}
          onSelectionChange={(key) => key !== null && set('usageResetDisplay')(String(key))}
          isRequired
          className="flex flex-col gap-2"
        >
          <Label>Show resets as</Label>
          <Select.Trigger className="min-h-11">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <FieldError />
          <Select.Popover>
            <ListBox>
              {RESET_DISPLAYS.map((option) => (
                <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <ComboBox
          name="timeZone"
          defaultItems={zoneItems}
          selectedKey={values.timeZone}
          onSelectionChange={(key) => key !== null && set('timeZone')(String(key))}
          isRequired
          menuTrigger="focus"
          className="flex flex-col gap-2"
        >
          <Label>Time zone</Label>
          <ComboBox.InputGroup>
            <Input className="min-h-11" />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <Description>For clock-time resets.</Description>
          <FieldError />
          <ComboBox.Popover>
            <ListBox>
              {(item: { id: string }) => (
                <ListBox.Item id={item.id} textValue={item.id}>
                  {item.id}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
        <NumberSetting name="usageWarnPct" value={values.usageWarnPct} onChange={set('usageWarnPct')} />
        <NumberSetting name="usageDangerPct" value={values.usageDangerPct} onChange={set('usageDangerPct')} />
      </section>

      <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 self-start">
        Save settings
      </Button>
    </Form>
  );
}
