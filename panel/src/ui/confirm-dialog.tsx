'use client';

import { AlertDialog, Button, Input, Label, TextField } from '@heroui/react';
import { useState, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  trigger: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Trigger style; defaults to danger/secondary by `danger`. `danger-soft` suits a button repeated on every list row. */
  triggerVariant?: 'danger' | 'danger-soft' | 'secondary' | 'ghost';
  /** The confirm button stays disabled until this text is typed (the server must still check it). */
  typeToConfirm?: string;
  isDisabled?: boolean;
  /** Runs on confirm; the dialog closes when it resolves and stays open if it rejects (the caller reports why). */
  onConfirm: () => void | Promise<void>;
}

/** An action behind a confirmation (HeroUI AlertDialog) with optional type-to-confirm. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { trigger, title, description, confirmLabel, danger, triggerVariant, typeToConfirm, isDisabled, onConfirm } =
    props;
  const [isOpen, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [isPending, setPending] = useState(false);
  const blocked = typeToConfirm !== undefined && typed.trim() !== typeToConfirm.trim();

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Stay open so the action can be retried; onConfirm has already told the user what went wrong.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) setTyped('');
        setOpen(open);
      }}
    >
      <Button variant={triggerVariant ?? (danger ? 'danger' : 'secondary')} isDisabled={isDisabled} className="min-h-11">
        {trigger}
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Heading className="text-lg font-bold text-white">
                {title}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-4">
              <p className="text-default-foreground">{description}</p>
              {typeToConfirm !== undefined ? (
                <TextField value={typed} onChange={setTyped} autoComplete="off" className="flex flex-col gap-2">
                  <Label>
                    Type <span className="font-mono text-white">{typeToConfirm}</span> to confirm
                  </Label>
                  <Input />
                </TextField>
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button slot="close" variant="tertiary" className="min-h-11">
                Cancel
              </Button>
              <Button
                variant={danger ? 'danger' : 'primary'}
                isPending={isPending}
                isDisabled={blocked}
                onPress={confirm}
                className="min-h-11"
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
