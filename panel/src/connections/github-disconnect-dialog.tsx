'use client';

import { AlertDialog, Button } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { notifyError, UNREACHABLE_MESSAGE } from '@/feedback/toast-host';
import { disconnectGithubApp } from './github-actions';

/**
 * Disconnect the App from this panel only. The App stays on GitHub (other tools, e.g. Coolify, may use
 * it), so this never calls GitHub.
 */
export function GithubDisconnectDialog({ slug }: { slug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      try {
        const result = await disconnectGithubApp();
        if (result.ok) router.replace('/connections/github?disconnected=1');
        else notifyError(result.message);
      } catch {
        notifyError(UNREACHABLE_MESSAGE);
      }
    });
  }

  return (
    <AlertDialog>
      <Button variant="danger-soft" className="min-h-11 self-start">
        Disconnect
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.Header>
              <AlertDialog.Heading className="text-lg font-bold text-white">Disconnect {slug}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3 text-default-foreground">
              <p>
                The panel forgets this App, its installations and your &quot;Authorize as me&quot; token. Running
                sessions lose GitHub access.
              </p>
              <p>Nothing changes on GitHub: the App stays installed for anything else that uses it.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button slot="close" variant="tertiary" className="min-h-11">
                Cancel
              </Button>
              <Button variant="danger" isPending={isPending} onPress={confirm} className="min-h-11">
                Disconnect
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
