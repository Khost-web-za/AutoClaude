'use client';

import { Button, Description, FieldError, Form, Label, TextArea, TextField } from '@heroui/react';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import type { DeliveryMode } from '@/db/schema';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { planMerge } from '@/profiles/merge-plan';
import type { Profile } from '@/profiles/profile-catalog';
import { ProfileCards } from '@/profiles/profile-cards';
import { Banner } from '@/ui/banner';
import type { PagedOption } from '@/ui/paged-combo-box';
import { SectionLabel } from '@/ui/section-label';
import { AutoResumeField } from './auto-resume-field';
import { BranchPicker } from './branch-picker';
import { DeliveryModeField } from './delivery-mode-field';
import { STARTING_TASK_MAX } from './new-session-limits';
import { repoDefaultsAction } from './new-session-actions';
import { RepoPicker } from './repo-picker';
import { startSessionAction } from './session-actions';

export type NewSessionPreset = { repo: string; baseBranch: string; profiles: string[]; deliveryMode: DeliveryMode; autoResume: boolean } | null;

function clashText(profiles: readonly Profile[], picked: string[]): string[] {
  try {
    return planMerge(picked, [...profiles]).clashes.map(
      (clash) => `${clash.kind} "${clash.name}": ${clash.winner} overrides ${clash.losers.join(', ')}`,
    );
  } catch {
    return [];
  }
}

/**
 * Repository, base branch, delivery mode, auto-resume, profiles and an optional starting task. Picking a repository fills in its
 * remembered base branch, delivery mode, auto-resume and profiles. Everything is validated again on the server; a refusal (no free
 * slot, low disk, no Sysbox) is toasted and the form keeps what was entered.
 */
export function NewSessionForm({
  profiles,
  preset,
  capacity,
}: {
  profiles: readonly Profile[];
  preset: NewSessionPreset;
  capacity: ReactNode;
}) {
  const router = useRouter();
  const [repo, setRepo] = useState<PagedOption | null>(preset ? { id: preset.repo, label: preset.repo } : null);
  const [branch, setBranch] = useState<string | null>(preset?.baseBranch ?? null);
  const [picked, setPicked] = useState<string[]>(preset?.profiles ?? []);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(preset?.deliveryMode ?? 'pull_request');
  const [autoResume, setAutoResume] = useState(preset?.autoResume ?? false);
  const [task, setTask] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();
  const clashes = clashText(profiles, picked);
  // Only the latest pick may apply its defaults: picking A then B quickly must never give B A's branch.
  const defaultsRequest = useRef(0);

  async function pickRepo(option: PagedOption | null) {
    setRepo(option);
    setBranch(null);
    setDeliveryMode('pull_request');
    setFieldErrors(({ repoFullName: _repo, baseBranch: _branch, ...rest }) => rest);
    const ticket = ++defaultsRequest.current;
    if (!option) return;
    try {
      const defaults = await repoDefaultsAction(option.id);
      if (ticket !== defaultsRequest.current) return;
      if (!defaults.ok) {
        notifyError(defaults.message);
        return;
      }
      setBranch(defaults.baseBranch);
      setDeliveryMode(defaults.deliveryMode);
      setAutoResume(defaults.autoResume);
      setPicked(defaults.profiles.filter((name) => profiles.some((profile) => profile.name === name)));
    } catch {
      if (ticket === defaultsRequest.current) notifyError(UNREACHABLE_MESSAGE);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await startSessionAction({
          repoFullName: repo?.id ?? '',
          baseBranch: branch ?? '',
          profiles: picked,
          deliveryMode,
          autoResume,
          startingTask: task,
        });
        if (result.ok) {
          setFieldErrors({});
          notifySuccess('Session starting.');
          router.push(`/sessions/${result.sessionId}`);
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        notifyError(result.message);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  const error = (key: string) => fieldErrors[key]?.[0];

  return (
    <Form onSubmit={submit} validationErrors={fieldErrors} className="flex max-w-4xl flex-col gap-12">
      <div className="grid gap-x-8 gap-y-8 md:grid-cols-2">
        <RepoPicker value={repo} onChange={(option) => void pickRepo(option)} errorMessage={error('repoFullName')} />
        <BranchPicker repo={repo?.id ?? null} value={branch} onChange={setBranch} errorMessage={error('baseBranch')} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionLabel>Session delivery</SectionLabel>
        <DeliveryModeField value={deliveryMode} onChange={setDeliveryMode} errorMessage={error('deliveryMode')} />
        <AutoResumeField isSelected={autoResume} onChange={setAutoResume} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Config profiles</SectionLabel>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted">No profiles found in configs/.</p>
        ) : (
          <ProfileCards profiles={profiles} selected={picked} onChange={setPicked} isInvalid={Boolean(error('profiles'))} />
        )}
        {error('profiles') ? <p className="text-sm text-danger">{error('profiles')}</p> : null}
        {clashes.length > 0 ? (
          <Banner tone="warning" title={`Name clash: ${clashes.join(' · ')}. The later profile wins.`} />
        ) : null}
        <p className="text-sm text-muted">Remembered per repository for next time.</p>
      </section>

      <TextField value={task} onChange={setTask} maxLength={STARTING_TASK_MAX} className="flex flex-col gap-2">
        <Label>
          Starting task <span className="font-normal text-text-subtle">(optional)</span>
        </Label>
        <TextArea rows={5} placeholder="What should Claude work on first?" className="min-h-32" />
        <Description>
          {deliveryMode === 'push' ? '' : 'Also names the working branch. '}{task.length.toLocaleString('en-US')} / {STARTING_TASK_MAX.toLocaleString('en-US')}
        </Description>
        <FieldError>{error('startingTask')}</FieldError>
      </TextField>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 gap-2 self-start">
          <Play aria-hidden className="size-4" />
          Start session
        </Button>
        <p className="text-sm text-text-subtle">{capacity}</p>
      </div>
    </Form>
  );
}
