import { readSessionLogs, LOG_TAIL_LINES } from '@/sessions/session-logs';
import { loadSessionForPage, type SessionRouteParams } from '@/sessions/session-page';
import { Banner } from '@/ui/banner';

/**
 * The container's last 500 lines. Read and redacted on the server (ANSI stripped, the repository's secret
 * values replaced by ••••): no unredacted line or secret value is ever sent to the browser.
 */
export default async function SessionLogsPage({ params }: SessionRouteParams) {
  const session = await loadSessionForPage(params);
  const logs = await readSessionLogs(session);
  if (!logs.ok) return <Banner tone="warning" title={logs.message} />;
  return (
    <section aria-label="Container logs" className="flex flex-col gap-3">
      <p className="text-sm text-text-subtle">
        Last {Math.min(logs.lines.length, LOG_TAIL_LINES)} lines · repository secrets are shown as ••••
      </p>
      {logs.lines.length === 0 ? (
        <p className="text-sm text-muted">The container has not written anything yet.</p>
      ) : (
        <pre className="max-h-[70vh] overflow-auto rounded-xl bg-footer p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-surface-foreground">
          {logs.lines.join('\n')}
        </pre>
      )}
    </section>
  );
}
