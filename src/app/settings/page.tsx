
'use client';

import React from 'react';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import LeftSidebar from '@/app/components/LeftSidebar';
import { ThemeCustomizer } from '@/app/components/ThemeCustomizer';


function SettingsHeader() {
    const { isMobile } = useSidebar();
    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className={isMobile ? "" : "hidden md:flex"} />
            <h2 className="text-xl font-bold font-headline truncate flex-1">Settings</h2>
        </header>
    );
}

export default function SettingsPage() {
  return (
    <SidebarProvider>
        <LeftSidebar />
        <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left]">
            <SidebarInset>
                <div className="flex flex-col h-screen">
                    <SettingsHeader />
                    <main className="flex-1 p-4 md:p-6">
                        <div className="max-w-xl mx-auto">
                            <ThemeCustomizer />
                        </div>
                    </main>
                </div>
            </SidebarInset>
        </div>
    </SidebarProvider>
  );
}
