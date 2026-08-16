import type {Metadata} from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import './globals.css';
import './workspace-parity.css';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from '@/hooks/use-session';
import { PopoutProvider } from '@/components/PopoutWidgets/PopoutProvider';
import { PopoutRenderer } from '@/components/PopoutWidgets/PopoutRenderer';
import { WorkspaceTruthProvider } from '@/components/workspace-truth-provider';
import { SpmtWorkspaceHost } from '@/components/spmt-workspace-host';
import { PersonalOverlayHost } from '@/components/personal-overlay-host';

export const metadata: Metadata = {
  title: 'HearMeOut',
  description: 'Collaborative music and voice chat rooms.',
  manifest: '/manifest.json',
  icons: {
    icon: '/brand/hearmeout-icon-192.png',
    apple: '/brand/hearmeout-icon-192.png',
    shortcut: '/favicon.ico',
  },
};

export const viewport = {
  themeColor: '#f06c4f',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased bg-background min-h-screen">
        <Script src="https://spmt.live/shared/ecosystem-header.js" data-app="hearmeout" strategy="afterInteractive" />
        <Script src="https://spmt.live/shared/workspace-controller.js" strategy="afterInteractive" />
        <PopoutProvider>
          <SessionProvider>
            <WorkspaceTruthProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <PopoutRenderer />
                <PersonalOverlayHost />
                <SpmtWorkspaceHost />
              </TooltipProvider>
            </WorkspaceTruthProvider>
          </SessionProvider>
        </PopoutProvider>
        <Toaster />
      </body>
    </html>
  );
}
