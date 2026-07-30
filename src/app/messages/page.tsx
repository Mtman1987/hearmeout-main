import LeftSidebar from '@/app/components/LeftSidebar';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ExternalLink, MessageSquare } from 'lucide-react';

export default function MessagesPage() {
  return (
    <SidebarProvider>
      <LeftSidebar />
      <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left]">
        <SidebarInset>
          <main className="flex h-screen min-h-0 flex-col p-3 md:p-5">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xl">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div className="flex items-center gap-3">
                  <SidebarTrigger />
                  <div>
                    <h1 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5" /> Commlink Messaging</h1>
                    <p className="text-xs text-muted-foreground">HearMeOut rooms, stream chats, Discord, voice, and media share one SPMT workspace.</p>
                  </div>
                </div>
                <a className="flex items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted" href="https://spmt.live/?view=commlink" target="_blank" rel="noopener noreferrer">
                  Open full workspace <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </header>
              <iframe
                className="min-h-0 flex-1 border-0"
                src="https://spmt.live/commlink/?embedded=1"
                title="SPMT Commlink messaging workspace"
                allow="microphone; autoplay; clipboard-write"
              />
            </section>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
