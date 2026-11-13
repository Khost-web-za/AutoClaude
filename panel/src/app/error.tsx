'use client';

import { Button } from '@heroui/react';
import { OctagonAlert } from 'lucide-react';
import { useEffect } from 'react';

/** A page whose data could not load (database, Docker or GitHub down). The layout and its shell stay up. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Server errors arrive without their message in production; the digest matches the server log line.
    console.error('[panel] page failed to load', error.digest ?? error.name);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-20 text-center">
      <OctagonAlert aria-hidden className="size-8 text-danger" />
      <h1 className="text-lg font-bold text-white">This page could not load</h1>
      <p className="max-w-md text-muted">
        The database, Docker or GitHub did not answer. Try again in a moment.
        {error.digest ? <span className="mt-2 block font-mono text-xs text-text-subtle">Ref {error.digest}</span> : null}
      </p>
      <Button variant="secondary" onPress={() => retry()} className="mt-2 min-h-11">
        Try again
      </Button>
    </div>
  );
}
