import { Brand } from './brand';
import { NavList } from './nav-list';

/** Desktop sidebar (lg and up). Below lg the same nav lives in the mobile sheet. */
export function PanelSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col gap-8 bg-sidebar px-4 py-6 lg:flex">
      <Brand />
      <nav aria-label="Panel" className="flex-1 overflow-y-auto">
        <NavList />
      </nav>
    </aside>
  );
}
