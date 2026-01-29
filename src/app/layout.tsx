import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase';
import { PopoutProvider } from '@/components/PopoutWidgets/PopoutProvider';
import { PopoutRenderer } from '@/components/PopoutWidgets/PopoutRenderer';

export const metadata: Metadata = {
  title: 'HearMeOut',
  description: 'Collaborative music and voice chat rooms.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const themeName = localStorage.getItem('active-theme') || 'Dark';
                  if (themeName.toLowerCase().includes('dark')) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased bg-background min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                fetch('/api/twitch-bot').catch(console.error);
              }
            `,
          }}
        />
        <PopoutProvider>
          <FirebaseClientProvider>
            {children}
          </FirebaseClientProvider>
          <PopoutRenderer />
        </PopoutProvider>
        <Toaster />
      </body>
    </html>
  );
}
