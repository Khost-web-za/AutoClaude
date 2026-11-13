/** The HTTP status dockerode attached to an Engine API error, if any. */
export function dockerStatusCode(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
}

/** A short, display-safe description of a Docker failure (the Engine's own message when it gave one). */
export function dockerErrorDetail(error: unknown): string {
  const engineMessage = (error as { json?: { message?: unknown } } | null)?.json?.message;
  const message =
    typeof engineMessage === 'string' && engineMessage
      ? engineMessage
      : error instanceof Error
        ? error.message
        : 'unknown error';
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}
