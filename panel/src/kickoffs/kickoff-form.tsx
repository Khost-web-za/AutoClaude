'use client';

import { Button, Description, Input, Label, TextField } from '@heroui/react';
import { Plus } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { instantToWallTime } from '@/time/zoned-time';
import { addKickoffAction } from './kickoff-actions';

const CHIP_HOURS = [1, 3, 5] as const;

/** Picks a start time (read in the settings zone) and schedules a kick-off. The list refreshes from the server. */
export function KickoffForm({ timeZone, defaultLocal }: { timeZone: string; defaultLocal: string }) {
  const [value, setValue] = useState(defaultLocal);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await addKickoffAction(value);
        if (result.ok) notifySuccess('Kick-off scheduled.');
        else notifyError(result.error);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <TextField value={value} onChange={setValue} isRequired className="flex flex-col gap-2">
        <Label>Start the window at</Label>
        <Input type="datetime-local" className="min-h-11" />
        <Description>Times are in {timeZone}.</Description>
      </TextField>
      <div className="flex flex-wrap items-center gap-2">
        {CHIP_HOURS.map((hours) => (
          <Button
            key={hours}
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11"
            onPress={() => setValue(instantToWallTime(new Date(Date.now() + hours * 3_600_000), timeZone))}
          >
            +{hours} h
          </Button>
        ))}
      </div>
      <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 self-start">
        <Plus aria-hidden className="size-4" />
        Add
      </Button>
    </form>
  );
}
