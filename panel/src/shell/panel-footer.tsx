import { HostStatsFooter } from '@/host/host-stats-footer';
import { LiveRefresh } from '@/live/live-refresh';

export function PanelFooter() {
  return (
    <footer className="flex min-h-11 flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-footer px-4 py-3 text-xs text-text-subtle sm:px-6 lg:px-10">
      <HostStatsFooter />
      <LiveRefresh />
    </footer>
  );
}
