'use client';

import { AlertDialog, Button, Input, Label, Skeleton, TextField } from '@heroui/react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SessionGitState } from '@/db/schema';
import { notifyError, notifySuccess, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { needsConfirmation } from './delete-confirmation';
import { deleteSessionAction, refreshWorkStateAction } from './session-actions';
import { useSessionLive } from './session-live-context';

type Check = { state: 'loading' } | { state: 'done'; gitState: SessionGitState } | { state: 'failed'; message: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function WorkSummary({ check }: { check: Check }) {
  if (check.state === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-56 rounded-lg" />
        <Skeleton className="h-4 w-40 rounded-lg" />
      </div>
    );
  }
  if (check.state === 'failed') {
    return (
      <p className="flex items-start gap-2 text-sm text-warning">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        Can&apos;t verify the workspace ({check.message}). Anything not pushed would be lost.
      </p>
    );
  }
  const { gitState } = check;
  if (gitState.error) {
    return (
      <p className="flex items-start gap-2 text-sm text-warning">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Can&apos;t verify the workspace: <span className="break-words">{gitState.error}</span>. Anything not pushed
          would be lost.
        </span>
      </p>
    );
  }
  if (!needsConfirmation(gitState)) {
    return (
      <p className="flex items-center gap-2 text-sm text-accent-text">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        Everything is committed and pushed.
      </p>
    );
  }
  const parts = [
    gitState.unpushedCommits > 0 ? plural(gitState.unpushedCommits, 'unpushed commit') : null,
    gitState.uncommittedFiles > 0 ? plural(gitState.uncommittedFiles, 'uncommitted file') : null,
  ].filter(Boolean);
  return (
    <p className="flex items-start gap-2 text-sm font-semibold text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {parts.join(' and ')} would be lost.
    </p>
  );
}

/**
 * Delete with the base spec's guard: opening re-reads the workspace's git state live. With unpushed,
 * uncommitted or unknown work the confirm button stays disabled until the repository name is typed
 * exactly. The server checks again whatever the dialog showed.
 */
export function DeleteSessionDialog({ triggerClassName = '' }: { triggerClassName?: string }) {
  const { id: sessionId, repoFullName, pending, track } = useSessionLive();
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'loading' });
  const [typed, setTyped] = useState('');
  const [isPending, setPending] = useState(false);

  const mustType = check.state === 'loading' ? false : check.state === 'failed' || needsConfirmation(check.gitState);
  const blocked = check.state === 'loading' || (mustType && typed.trim() !== repoFullName);

  async function loadCheck() {
    setCheck({ state: 'loading' });
    try {
      const result = await refreshWorkStateAction(sessionId);
      setCheck(result.ok ? { state: 'done', gitState: result.gitState } : { state: 'failed', message: result.message });
    } catch {
      setCheck({ state: 'failed', message: 'the panel could not be reached' });
    }
  }

  // Optimistic: the page shows the session as stopped while the delete runs; a refusal rolls that back,
  // keeps the dialog open (with the state the server saw) and toasts why.
  function confirm() {
    setPending(true);
    track('delete', async () => {
      try {
        const result = await deleteSessionAction(sessionId, mustType ? typed : undefined);
        if (result.ok) {
          notifySuccess(result.message);
          setOpen(false);
          router.push('/');
          return;
        }
        if (result.reason === 'needs-confirmation') setCheck({ state: 'done', gitState: result.gitState });
        notifyError(result.message);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) {
          setTyped('');
          void loadCheck();
        }
      }}
    >
      <Button variant="danger-soft" isDisabled={pending !== null} className={`min-h-11 ${triggerClassName}`}>
        Delete…
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Heading className="text-lg font-bold text-white">Delete this session?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-4">
              <p className="text-default-foreground">
                The container and its workspace are removed for good. Pushed commits stay on GitHub.
              </p>
              <WorkSummary check={check} />
              {mustType ? (
                <TextField value={typed} onChange={setTyped} autoComplete="off" className="flex flex-col gap-2">
                  <Label>
                    Type <span className="font-mono text-white">{repoFullName}</span> to delete anyway
                  </Label>
                  <Input spellCheck={false} />
                </TextField>
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button slot="close" variant="tertiary" className="min-h-11">
                Cancel
              </Button>
              <Button variant="danger" isPending={isPending} isDisabled={blocked} onPress={confirm} className="min-h-11">
                Delete session
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
