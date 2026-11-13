'use client';

import { Button, Description, FieldError, Form, Input, Label, TextArea, TextField } from '@heroui/react';
import { Plus } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { setRepoSecret } from './secret-actions';

/**
 * Write-only "add or replace" form. Values go to the server and are never read back; the fields
 * clear after a successful save and keep what was typed after a rejection.
 */
export function SecretForm({ repo }: { repo: string }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof setRepoSecret>>;
      try {
        result = await setRepoSecret(repo, key.trim(), value);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
        return;
      }
      if (result.status === 'success') {
        setKey('');
        setValue('');
        setFieldErrors(undefined);
        notifySuccess(result.message);
      } else if (result.status === 'error') {
        setFieldErrors(result.fieldErrors);
        if (!result.fieldErrors) notifyError(result.message);
      }
    });
  }

  return (
    <Form onSubmit={submit} validationErrors={fieldErrors} className="flex max-w-2xl flex-col gap-6">
      <TextField name="key" value={key} onChange={setKey} isRequired className="flex max-w-md flex-col gap-2">
        <Label>Name</Label>
        <Input
          placeholder="API_KEY"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="min-h-11 font-mono"
        />
        <Description>A–Z, 0–9 and _. Saving an existing name replaces its value.</Description>
        <FieldError />
      </TextField>
      <TextField name="value" value={value} onChange={setValue} isRequired className="flex flex-col gap-2">
        <Label>Value</Label>
        <TextArea rows={4} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
        <Description>Up to 32 KB, multi-line allowed. It is encrypted and never shown again.</Description>
        <FieldError />
      </TextField>
      <Button type="submit" variant="primary" isPending={isPending} className="min-h-11 self-start">
        <Plus aria-hidden className="size-4" />
        Save secret
      </Button>
    </Form>
  );
}
