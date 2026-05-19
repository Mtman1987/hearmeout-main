'use client';

import React from 'react';
import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Lock, Users, Clock } from "lucide-react";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import LeftSidebar from '@/app/components/LeftSidebar';
import { useSession } from '@/hooks/use-session';
import { useCollection } from '@/hooks/use-db';
import { dbDelete } from '@/lib/db-helpers';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

function DashboardHeader() {
    const { isMobile } = useSidebar();
    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className={isMobile ? "" : "hidden md:flex"} />
            <h2 className="text-xl font-bold font-headline truncate flex-1">Dashboard</h2>
        </header>
    );
}

interface Room {
    id: string;
    name: string;
    ownerId: string;
    isPrivate?: boolean;
    password?: string;
    occupantCount?: number;
    expiresAt?: string;
    createdAt?: string;
}

function timeRemaining(expiresAt?: string) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m left`;
}

export default function Home() {
  const { user } = useSession();
  const { toast } = useToast();
  // Show ALL rooms — both public and private are visible
  const { data: allRooms, isLoading: roomsLoading } = useCollection<Room>('rooms');



  const isAdmin = !!user && ((user as any).isAdmin || user.discordId === '767875979561009173');

  const handleDeleteRoom = (roomId: string, roomName: string) => {
    if (!user) return;
    if (!confirm(`Delete "${roomName}"? This cannot be undone.`)) return;
    dbDelete('rooms', roomId);
    toast({ title: 'Room Deleted', description: `"${roomName}" has been deleted.` });
  };

  return (
    <SidebarProvider>
        <LeftSidebar />
        <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left]">
            <SidebarInset>
                <div className="flex flex-col min-h-screen">
                    <DashboardHeader />
                    <main className="flex-1 container mx-auto py-8 px-4">
                        
                        <h2 className="text-3xl font-bold font-headline mb-6 text-foreground">Rooms</h2>
                        {roomsLoading && (
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                             </div>
                        )}
                        {!roomsLoading && allRooms && allRooms.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {allRooms.map((room) => (
                                <Card key={room.id} className="flex flex-col hover:shadow-lg transition-shadow duration-300">
                                <CardHeader>
                                    <CardTitle className="font-headline flex items-center justify-between">
                                        <span className="flex items-center gap-2 truncate">
                                            {room.isPrivate && <Lock className="h-4 w-4 text-muted-foreground shrink-0" />}
                                            {room.name}
                                        </span>
                                        {user && (room.ownerId === user.uid || isAdmin) && (
                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteRoom(room.id, room.name)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex-grow space-y-1">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Users className="h-3.5 w-3.5" />
                                        <span>{room.occupantCount || 0} in room</span>
                                    </div>
                                    {room.expiresAt && (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            <span>{timeRemaining(room.expiresAt)}</span>
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter>
                                    <Button asChild className="w-full">
                                    <Link href={`/rooms/${room.id}`}>{room.isPrivate ? 'Join (Password Required)' : 'Join Room'}</Link>
                                    </Button>
                                </CardFooter>
                                </Card>
                            ))}
                            </div>
                        )}
                        {!roomsLoading && (!allRooms || allRooms.length === 0) && (
                            <div className="text-center text-muted-foreground py-16">
                                <h3 className="text-xl font-semibold">No rooms yet</h3>
                                <p className="mt-2">Be the first to create one!</p>
                            </div>
                        )}
                    </main>
                    <footer className="py-4 text-center text-sm text-muted-foreground">
                        © {new Date().getFullYear()} HearMeOut. All rights reserved.
                    </footer>
                </div>
            </SidebarInset>
        </div>
    </SidebarProvider>
  );
}

