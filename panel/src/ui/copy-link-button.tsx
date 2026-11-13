'use client';

import { Button } from '@heroui/react';
import { Copy } from 'lucide-react';
import { notifyError, notifySuccess } from '@/feedback/toast-host';

/**
 * Copies a link instead of following it, for opening it in another browser or profile (e.g. one signed
 * in to a different GitHub account).
 */
export function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      notifySuccess('Link copied. Paste it in the browser signed in to the right account.');
    } catch {
      notifyError('Could not copy the link.');
    }
  }
  return (
    <Button variant="secondary" onPress={copy} className="min-h-11">
      <Copy aria-hidden className="size-4" />
      {label}
    </Button>
  );
}
