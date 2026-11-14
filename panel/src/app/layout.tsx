import type { Metadata } from 'next';
import { Fira_Code, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ToastHost } from '@/feedback/toast-host';
import { PanelFooter } from '@/shell/panel-footer';
import { PanelSidebar } from '@/shell/panel-sidebar';
import { PanelTopBar } from '@/shell/panel-top-bar';
import { SiteBanners } from '@/shell/site-banners';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'AutoClaude', template: '%s - AutoClaude' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`dark ${inter.variable} ${firaCode.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">
        <div className="lg:flex">
          <PanelSidebar />
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip">
            <PanelTopBar />
            <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-10">
              <SiteBanners />
              {children}
            </main>
            <PanelFooter />
          </div>
        </div>
        <ToastHost />
      </body>
    </html>
  );
}
