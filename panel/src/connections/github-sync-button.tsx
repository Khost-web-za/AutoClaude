'use client';

import { Button } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';
import { notifyError, notifySuccess } from '@/feedback/toast-host';
import { syncGithubInstallations } from './github-actions';

/** Re-reads the installation list from GitHub (for installs or removals made on github.com). */
export function GithubSyncButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      isPending={isPending}
      className="min-h-11"
      onPress={() =>
        startTransition(async () => {
          const result = await syncGithubInstallations();
          if (result.ok) notifySuccess(result.message);
          else notifyError(result.message);
        })
      }
    >
      <RefreshCw aria-hidden className="size-4" />
      Sync
    </Button>
  );
}
