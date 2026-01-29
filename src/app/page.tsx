'use client';

import React from 'react';
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Music, Trash2 } from "lucide-react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import LeftSidebar from '@/app/components/LeftSidebar';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { deleteDoc, doc } from 'firebase/firestore';


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
}

export default function Home() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const publicRoomsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
        collection(firestore, 'rooms'),
        where('isPrivate', '==', false)
    );
  }, [firestore]);

  const { data: publicRooms, isLoading: roomsLoading } = useCollection<Room>(publicRoomsQuery);

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!firestore || !user) return;
    if (!confirm(`Delete "${roomName}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(firestore, 'rooms', roomId));
      toast({ title: 'Room Deleted', description: `"${roomName}" has been deleted.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete room.' });
    }
  };

  return (
    <SidebarProvider>
        <LeftSidebar />
        <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left]">
            <SidebarInset>
                <div className="flex flex-col min-h-screen">
                    <DashboardHeader />
                    <main className="flex-1 container mx-auto py-8 px-4">
                        <h2 className="text-3xl font-bold font-headline mb-6 text-foreground">
                        Public Rooms
                        </h2>
                        {roomsLoading && (
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                                <Card><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><div className='h-4'></div></CardContent><CardFooter><Skeleton className="h-10 w-full" /></CardFooter></Card>
                             </div>
                        )}
                        {!roomsLoading && publicRooms && publicRooms.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {publicRooms.map((room) => (
                                <Card key={room.id} className="flex flex-col hover:shadow-lg transition-shadow duration-300">
                                <CardHeader>
                                    <CardTitle className="font-headline flex items-center justify-between">
                                        {room.name}
                                        {user && room.ownerId === user.uid && (
                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteRoom(room.id, room.name)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex-grow">
                                </CardContent>
                                <CardFooter>
                                    <Button asChild className="w-full">
                                    <Link href={`/rooms/${room.id}`}>Join Room</Link>
                                    </Button>
                                </CardFooter>
                                </Card>
                            ))}
                            </div>
                        )}
                        {!roomsLoading && (!publicRooms || publicRooms.length === 0) && (
                            <div className="text-center text-muted-foreground py-16">
                                <h3 className="text-xl font-semibold">No public rooms yet</h3>
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
