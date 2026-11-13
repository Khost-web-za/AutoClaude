'use client';

import { Button, Description, FieldError, Form, Input, Label, TextArea, TextField } from '@heroui/react';
import { Wand2 } from 'lucide-react';
import { useActionState, useRef, useState, useTransition } from 'react';
import { IDLE_FORM } from '@/feedback/form-state';
import { submitWithoutReset } from '@/feedback/form-submit';
import { withToast } from '@/feedback/toast-host';
import { SectionLabel } from '@/ui/section-label';
import { beginGithubAppCreation, saveExistingGithubApp } from './github-actions';

/**
 * "Create GitHub App" (GitHub's manifest flow): the server sets the state cookie, then the browser POSTs the
 * manifest to GitHub, which creates the App and redirects back to the manifest callback.
 */
function CreateAppForm() {
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const postForm = useRef<HTMLFormElement>(null);
  const manifestInput = useRef<HTMLInputElement>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const flow = await beginGithubAppCreation(organization);
      if (!flow.ok || !postForm.current || !manifestInput.current) {
        setError(flow.ok ? 'Could not open GitHub. Reload and try again.' : flow.message);
        return;
      }
      postForm.current.action = flow.postUrl;
      manifestInput.current.value = flow.manifest;
      postForm.current.submit();
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionLabel>Create a GitHub App</SectionLabel>
      <p className="text-sm text-muted">
        GitHub creates an App with exactly the permissions sessions need (contents, pull requests, workflows) and
        hands its keys straight to this panel. No copying keys by hand.
      </p>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <TextField value={organization} onChange={setOrganization} autoComplete="off" className="flex flex-col gap-2">
          <Label>Organization (optional)</Label>
          <Input placeholder="Leave empty for your personal account" maxLength={39} className="min-h-11" />
          <Description>Type an organization name to create the App under it instead.</Description>
        </TextField>
        <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 self-start">
          <Wand2 aria-hidden className="size-4" />
          Create GitHub App
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
      {/* Native POST to GitHub (cross-origin, top-level), filled in once the server has issued the state. */}
      <form ref={postForm} method="post" className="hidden" aria-hidden>
        <input ref={manifestInput} type="hidden" name="manifest" />
      </form>
    </section>
  );
}

const EXISTING_FIELDS = [
  { name: 'appId', label: 'App ID', inputMode: 'numeric' as const, placeholder: '123456' },
  { name: 'slug', label: 'App slug', placeholder: 'my-claudecloud', description: 'From the App URL: github.com/apps/<slug>' },
  { name: 'clientId', label: 'Client ID', placeholder: 'Iv23li…' },
] as const;

type ExistingField = (typeof EXISTING_FIELDS)[number]['name'] | 'clientSecret' | 'privateKey';

/**
 * "Use an existing App": write-only secrets, checked against GitHub before anything is stored. Controlled,
 * so a rejected submission keeps what was pasted (dispatched from onSubmit: see submitWithoutReset).
 */
function ExistingAppForm() {
  const [state, formAction, isPending] = useActionState(withToast(saveExistingGithubApp), IDLE_FORM);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const [values, setValues] = useState<Record<ExistingField, string>>({
    appId: '',
    slug: '',
    clientId: '',
    clientSecret: '',
    privateKey: '',
  });
  const bind = (name: ExistingField) => ({
    name,
    value: values[name],
    onChange: (value: string) => setValues((current) => ({ ...current, [name]: value })),
  });
  return (
    <section className="flex flex-col gap-5">
      <SectionLabel>Use an existing App</SectionLabel>
      <p className="text-sm text-muted">
        Already have one? It needs contents, pull requests and workflows (write) and metadata (read). Secrets are
        stored encrypted and never shown again.
      </p>
      <Form onSubmit={submitWithoutReset(formAction)} validationErrors={fieldErrors} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {EXISTING_FIELDS.map((field) => (
            <TextField key={field.name} {...bind(field.name)} isRequired autoComplete="off" className="flex flex-col gap-2">
              <Label>{field.label}</Label>
              <Input
                placeholder={field.placeholder}
                inputMode={'inputMode' in field ? field.inputMode : undefined}
                className="min-h-11 font-mono"
              />
              {'description' in field ? <Description>{field.description}</Description> : null}
              <FieldError />
            </TextField>
          ))}
          <TextField {...bind('clientSecret')} type="password" isRequired autoComplete="off" className="flex flex-col gap-2">
            <Label>Client secret</Label>
            <Input className="min-h-11 font-mono" />
            <FieldError />
          </TextField>
        </div>
        <TextField {...bind('privateKey')} isRequired autoComplete="off" className="flex flex-col gap-2">
          <Label>Private key</Label>
          <TextArea rows={5} spellCheck={false} placeholder="-----BEGIN RSA PRIVATE KEY-----" className="font-mono text-xs" />
          <Description>The whole .pem file you downloaded from the App settings.</Description>
          <FieldError />
        </TextField>
        <Button type="submit" variant="secondary" isPending={isPending} className="min-h-11 self-start">
          Save App
        </Button>
      </Form>
    </section>
  );
}

/** Shown while no App is configured: create one, or bring your own. */
export function GithubAppSetup() {
  return (
    <div className="grid max-w-6xl gap-12 lg:grid-cols-2 lg:gap-16">
      <CreateAppForm />
      <ExistingAppForm />
    </div>
  );
}
