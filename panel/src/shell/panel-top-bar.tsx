import { UsageSlot } from '@/usage/usage-slot';
import { Brand } from './brand';
import { ConnectionPill } from './connection-pill';
import { GlobalSearch } from './global-search';
import { MobileNavSheet } from './mobile-nav-sheet';

/**
 * 60 px header. Desktop: search left, usage + connection right. Below lg: menu button and brand;
 * search moves into the menu sheet.
 */
export function PanelTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-15 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-6 lg:px-10">
      <MobileNavSheet />
      <div className="lg:hidden">
        <Brand />
      </div>
      <GlobalSearch className="hidden max-w-md lg:block" />
      <div className="ml-auto flex items-center gap-3">
        <UsageSlot />
        <ConnectionPill />
      </div>
    </header>
  );
}
