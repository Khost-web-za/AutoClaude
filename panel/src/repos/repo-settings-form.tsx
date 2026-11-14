'use client';

import { Button, Description, FieldError, Form, Input, Label, TextField } from '@heroui/react';
import { useActionState, useState } from 'react';
import { IDLE_FORM, type FormAction } from '@/feedback/form-state';
import { submitWithoutReset } from '@/feedback/form-submit';
import { withToast } from '@/feedback/toast-host';
import type { Profile } from '@/profiles/profile-catalog';
import { ProfileCards } from '@/profiles/profile-cards';
import { AutoResumeField } from '@/sessions/auto-resume-field';
import { DeliveryModeField } from '@/sessions/delivery-mode-field';
import { RESUME_MESSAGE_MAX } from './resume-message';
import { SectionLabel } from '@/ui/section-label';
import type { RepoSettings } from './repo-settings-store';

/** Default base branch, delivery mode, auto-resume and default profiles for New session. Controlled, so the input stays put after a save or a rejection. */
export function RepoSettingsForm({
  settings,
  githubDefaultBranch,
  profiles,
  action,
}: {
  settings: RepoSettings;
  githubDefaultBranch: string;
  profiles: readonly Profile[];
  action: FormAction;
}) {
  const [state, formAction, isPending] = useActionState(withToast(action), IDLE_FORM);
  const [branch, setBranch] = useState(settings.defaultBaseBranch ?? '');
  const [picked, setPicked] = useState<string[]>(settings.defaultProfiles);
  const [deliveryMode, setDeliveryMode] = useState(settings.deliveryMode);
  const [autoResume, setAutoResume] = useState(settings.autoResume);
  const [resumeMessage, setResumeMessage] = useState(settings.resumeMessage);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <Form onSubmit={submitWithoutReset(formAction)} validationErrors={fieldErrors} className="flex max-w-4xl flex-col gap-12">
      <section className="flex flex-col gap-4">
        <SectionLabel>Base branch</SectionLabel>
        <TextField name="defaultBaseBranch" value={branch} onChange={setBranch} className="flex max-w-md flex-col gap-2">
          <Label>Default base branch</Label>
          <Input
            placeholder={githubDefaultBranch}
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 font-mono"
          />
          <Description>
            New sessions branch off this. Leave empty to use the repository default ({githubDefaultBranch}).
          </Description>
          <FieldError />
        </TextField>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Session delivery</SectionLabel>
        <DeliveryModeField
          name="deliveryMode"
          value={deliveryMode}
          onChange={setDeliveryMode}
          errorMessage={fieldErrors?.deliveryMode?.[0]}
        />
        <AutoResumeField name="autoResume" isSelected={autoResume} onChange={setAutoResume} />
        {autoResume ? (
          <TextField name="resumeMessage" value={resumeMessage} onChange={setResumeMessage} className="flex max-w-md flex-col gap-2">
            <Label>Resume message</Label>
            <Input maxLength={RESUME_MESSAGE_MAX} autoComplete="off" className="min-h-11" />
            <Description>Typed into the session when it resumes.</Description>
            <FieldError />
          </TextField>
        ) : (
          // Kept in the form so switching off does not forget the message.
          <input type="hidden" name="resumeMessage" value={resumeMessage} />
        )}
        <p className="text-sm text-muted">Pre-selected when you start a session on this repository.</p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Default profiles</SectionLabel>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted">No profiles found in configs/.</p>
        ) : (
          <ProfileCards
            profiles={profiles}
            selected={picked}
            onChange={setPicked}
            name="profiles"
            isInvalid={Boolean(fieldErrors?.profiles)}
          />
        )}
        {fieldErrors?.profiles ? <p className="text-sm text-danger">{fieldErrors.profiles[0]}</p> : null}
        <p className="text-sm text-muted">
          Ticked when you start a session on this repository. Starting a session also remembers what you picked.
        </p>
      </section>

      <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 self-start">
        Save repository settings
      </Button>
    </Form>
  );
}
