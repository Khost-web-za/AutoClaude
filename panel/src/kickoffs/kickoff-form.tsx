'use client';

import { Button, Description, Input, Label, TextField } from '@heroui/react';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { instantToWallTime, wallTimeToInstant } from '@/time/zoned-time';
import { addKickoffAction } from './kickoff-actions';
import { pendingKickoff } from './kickoff-changes';
import type { RunKickoffChange } from './kickoff-schedule';

const CHIP_HOURS = [1, 3, 5] as const;

/**
 * Picks a start time (read in the settings zone) and schedules a kick-off. The new row shows in the list at
 * once (optimistic); the server validates the time and, if it says no, the row goes away and a toast says why.
 */
export function KickoffForm({
  timeZone,
  defaultLocal,
  run,
  nextPendingId,
}: {
  timeZone: string;
  defaultLocal: string;
  run: RunKickoffChange;
  nextPendingId: () => string;
}) {
  const [value, setValue] = useState(defaultLocal);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const local = value;
    let runAt: Date;
    try {
      runAt = wallTimeToInstant(local, timeZone);
    } catch {
      return; // not a complete wall time; the required field already says so
    }
    run({ type: 'add', row: pendingKickoff(nextPendingId(), runAt) }, () => addKickoffAction(local));
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
      <Button type="submit" variant="primary" className="min-h-11 self-start">
        <Plus aria-hidden className="size-4" />
        Add
      </Button>
    </form>
  );
}
