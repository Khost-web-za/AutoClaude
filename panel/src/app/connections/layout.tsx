import type { ReactNode } from 'react';
import { ConnectionTabs } from '@/connections/connection-tabs';
import { PageHeader } from '@/ui/page-header';

/** Heading and tabs stay put while a tab's data streams in. Every tab page calls requireOwner(). */
export default function ConnectionsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Accounts this panel uses. Credentials are stored encrypted in this deployment and never shown back to you."
      />
      <div className="mb-8">
        <ConnectionTabs />
      </div>
      {children}
    </>
  );
}
