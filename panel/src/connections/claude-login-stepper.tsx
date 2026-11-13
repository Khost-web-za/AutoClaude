'use client';

import { Button, Input, Label, TextField } from '@heroui/react';
import { Check, Copy, Link2 } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { notifyError, notifySuccess } from '@/feedback/toast-host';
import { SectionLabel } from '@/ui/section-label';
import { cancelClaudeLogin, finishClaudeLogin, startClaudeLogin } from './claude-actions';

type Login = { loginId: string; url: string };

function Step({
  index,
  state,
  title,
  hint,
  children,
}: {
  index: number;
  state: 'done' | 'current' | 'todo';
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const marker =
    state === 'done'
      ? 'bg-accent text-on-accent'
      : state === 'current'
        ? 'bg-surface-secondary text-white ring-2 ring-accent'
        : 'bg-surface-secondary text-muted';
  return (
    <li className="flex gap-4 pb-7 last:pb-0" aria-current={state === 'current' ? 'step' : undefined}>
      <span
        aria-hidden
        className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${marker}`}
      >
        {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <div className={`text-sm ${state === 'todo' ? 'text-muted' : 'text-surface-foreground'}`}>
          {title}
          {hint ? <span className="mt-1 block text-xs text-text-subtle">{hint}</span> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Connect / Re-connect: start the helper, open the link, paste the code back (mockup `connections.html`). */
export function ClaudeLoginStepper({ connected }: { connected: boolean }) {
  const [login, setLogin] = useState<Login | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, startStarting] = useTransition();
  const [isFinishing, startFinishing] = useTransition();
  const verb = connected ? 'Re-connect' : 'Connect';

  function begin() {
    setError(null);
    startStarting(async () => {
      const result = await startClaudeLogin();
      if (result.ok) setLogin({ loginId: result.loginId, url: result.url });
      else setError(result.message);
    });
  }

  function finish() {
    if (!login) return;
    setError(null);
    startFinishing(async () => {
      const result = await finishClaudeLogin(login.loginId, code);
      if (result.ok) {
        setLogin(null);
        setCode('');
        notifySuccess('Claude connected.');
      } else if (result.retry) {
        // The helper is still waiting: keep the link and let the owner paste again.
        setError(result.message);
      } else {
        // The helper is gone (failed attempt, timeout, or a panel restart lost it): back to step 1.
        setLogin(null);
        setCode('');
        setError(result.message);
      }
    });
  }

  function cancel() {
    if (!login) return;
    const { loginId } = login;
    setLogin(null);
    setCode('');
    // The helper also removes itself on its own timer, so a failed cancel only needs telling.
    cancelClaudeLogin(loginId).catch(() => notifyError('Could not stop the login helper. It will time out on its own.'));
  }

  async function copyLink() {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(login.url);
      notifySuccess('Link copied.');
    } catch {
      notifyError('Could not copy. Select the link and copy it instead.');
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionLabel>{verb} Claude</SectionLabel>
      <ol className="flex flex-col">
        <Step
          index={1}
          state={login ? 'done' : 'current'}
          title="Start a login helper"
          hint={
            <>
              Runs <code className="font-mono text-accent-text">claude auth login</code> in a short-lived container.
            </>
          }
        >
          {login ? null : (
            <Button variant="primary" isPending={isStarting} onPress={begin} className="min-h-11 self-start">
              {isStarting ? 'Starting…' : verb}
            </Button>
          )}
        </Step>
        <Step index={2} state={login ? 'current' : 'todo'} title="Open this link and approve with your Claude account">
          {login ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-field-background py-1 pr-1 pl-3">
              <Link2 aria-hidden className="size-4 shrink-0 text-accent-text" />
              <a
                href={login.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate font-mono text-xs text-accent-text underline-offset-4 hover:underline"
              >
                {login.url}
              </a>
              <Button isIconOnly variant="ghost" aria-label="Copy link" onPress={copyLink} className="size-11 shrink-0">
                <Copy aria-hidden className="size-4" />
              </Button>
            </div>
          ) : null}
        </Step>
        <Step
          index={3}
          state={login ? 'current' : 'todo'}
          title="Paste the code Claude shows you"
          hint="Running sessions keep working. New sessions use the new login."
        >
          {login ? (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                finish();
              }}
            >
              <TextField value={code} onChange={setCode} autoComplete="off" className="flex flex-1 flex-col gap-2">
                <Label className="sr-only">Login code</Label>
                <Input placeholder="Paste code…" maxLength={512} spellCheck={false} className="min-h-11 font-mono" />
              </TextField>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  isPending={isFinishing}
                  isDisabled={code.trim() === ''}
                  className="min-h-11 flex-1 sm:flex-none"
                >
                  <Check aria-hidden className="size-4" />
                  Finish
                </Button>
                <Button variant="tertiary" isDisabled={isFinishing} onPress={cancel} className="min-h-11">
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </Step>
      </ol>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
