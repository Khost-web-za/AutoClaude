import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { submitWithoutReset } from '@/feedback/form-submit';

const SRC = path.join(import.meta.dirname, '..', '..', 'src');

function clientComponents(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => /^['"]use client['"]/.test(readFileSync(file, 'utf8')));
}

describe('submitWithoutReset', () => {
  it('stops the native submit and hands the form data to the dispatcher', () => {
    const preventDefault = vi.fn();
    const dispatch = vi.fn();
    // Node's FormData accepts no form element; `undefined` stands in for an empty form.
    const event = { preventDefault, currentTarget: undefined } as unknown as FormEvent<HTMLFormElement>;
    submitWithoutReset(dispatch)(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0]).toBeInstanceOf(FormData);
  });

  // React resets a `<form action={fn}>` after the action runs and react-aria's controlled fields then
  // revert to their first-render values. Client forms must dispatch from onSubmit instead.
  it('no client component passes a function as a form action', () => {
    const offenders = clientComponents(SRC).filter((file) =>
      /<(?:form|Form)\b[^>]*\saction=\{/s.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});
