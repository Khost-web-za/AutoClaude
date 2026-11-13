import { buttonVariants } from '@heroui/react';
import { MessageSquareText } from 'lucide-react';

/**
 * "Open in Claude": the session's Remote Control link, in a new tab. No arrow icon (spec). Until the
 * runner has reported the link it is shown disabled with the reason.
 */
export function OpenInClaudeButton({
  url,
  variant = 'button',
  className = '',
}: {
  url: string | null;
  variant?: 'button' | 'link';
  className?: string;
}) {
  if (variant === 'link') {
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`relative z-10 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus ${className}`}
      >
        <MessageSquareText aria-hidden className="size-4" />
        Open in Claude
      </a>
    ) : (
      <span className={`inline-flex min-h-11 items-center text-xs whitespace-nowrap text-text-subtle ${className}`}>
        Not connected yet
      </span>
    );
  }
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'primary', className: `min-h-11 gap-2 ${className}` })}
    >
      <MessageSquareText aria-hidden className="size-4" />
      Open in Claude
    </a>
  ) : (
    <span
      aria-disabled="true"
      title="Available once the session has connected to Claude"
      className={buttonVariants({ variant: 'secondary', className: `min-h-11 cursor-not-allowed gap-2 opacity-60 ${className}` })}
    >
      <MessageSquareText aria-hidden className="size-4" />
      Open in Claude
    </span>
  );
}
