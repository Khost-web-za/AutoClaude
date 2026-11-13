'use client';

import { Button, Drawer } from '@heroui/react';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Brand } from './brand';
import { GlobalSearch } from './global-search';
import { NavList } from './nav-list';

/** Phone and tablet navigation (below lg): a menu button that opens the nav and search in a drawer. */
export function MobileNavSheet() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <Button
        isIconOnly
        variant="ghost"
        aria-label="Open menu"
        className="size-11"
        onPress={() => setOpen(true)}
      >
        <Menu aria-hidden className="size-5" />
      </Button>
      <Drawer isOpen={open} onOpenChange={setOpen}>
        <Drawer.Backdrop>
          <Drawer.Content placement="left" className="bg-sidebar">
            <Drawer.Dialog aria-label="Menu" className="w-72 max-w-[85vw] bg-sidebar">
              <Drawer.Body className="flex flex-col gap-8 px-4 py-6">
                <Brand />
                <GlobalSearch />
                <nav aria-label="Panel">
                  <NavList onNavigate={() => setOpen(false)} />
                </nav>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
