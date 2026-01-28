'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Home, Music, LogOut, Settings, User, LogIn } from 'lucide-react';
import { Logo } from '@/app/components/Logo';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateRoomDialog } from '@/app/rooms/_components/CreateRoomDialog';
import { collection, query, where } from 'firebase/firestore';

interface Room {
    id: string;
    name: string;
    isPrivate: boolean;
}

export default function LeftSidebar({ roomId }: { roomId?: string }) {
  const pathname = usePathname();
  const { user, auth, isUserLoading, firestore } = useFirebase();

  const publicRoomsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
        collection(firestore, 'rooms'), 
        where('isPrivate', '==', false)
    );
  }, [firestore]);

  const { data: publicRooms, isLoading: roomsLoading } = useCollection<Room>(publicRoomsQuery);


  const handleLogout = () => {
    if (auth) {
      auth.signOut();
    }
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <Logo />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/'}>
              <Link href="/">
                <Home />
                Home
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarGroup>
          <SidebarGroupLabel>Public Rooms</SidebarGroupLabel>
          <SidebarMenu>
            {roomsLoading && (
                <>
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </>
            )}
            {publicRooms && publicRooms.map(room => (
              <SidebarMenuItem key={room.id}>
                <SidebarMenuButton asChild isActive={room.id === roomId}>
                  <Link href={`/rooms/${room.id}`}>
                    <Music />
                    {room.name}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
             {!roomsLoading && (!publicRooms || publicRooms.length === 0) && (
              <p className="px-2 text-sm text-muted-foreground">No public rooms yet.</p>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className='gap-4'>
        <CreateRoomDialog />
        <div className="border-t -mx-2"></div>
        
        {isUserLoading ? (
            <>
              <div className="flex items-center gap-3 p-2 rounded-md">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex flex-col flex-1 overflow-hidden gap-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                  </div>
              </div>
              <div className='flex gap-2'>
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
              </div>
            </>
        ) : user ? (
            <>
                <div className="flex items-center gap-3 p-2 rounded-md">
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`} alt="User Avatar" data-ai-hint="person portrait" />
                        <AvatarFallback>{user.isAnonymous ? 'G' : user.displayName?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col flex-1 overflow-hidden">
                        <p className="text-sm font-medium leading-none truncate">{user.isAnonymous ? 'Guest User' : user.displayName || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground truncate">
                            {user.email || (user.isAnonymous ? 'guest@hearmeout.com' : 'Anonymous User')}
                        </p>
                    </div>
                </div>
                <div className='flex gap-2'>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" className='flex-1' disabled={user.isAnonymous}>
                                <User/>
                                <span className='sr-only'>Profile</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Profile</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" asChild className='flex-1'>
                                <Link href="/settings">
                                    <Settings/>
                                    <span className='sr-only'>Settings</span>
                                </Link>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Settings</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={handleLogout} className='flex-1'>
                                <LogOut />
                                <span className='sr-only'>Log out</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>Log out</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            </>
        ) : (
            <Button asChild>
                <Link href="/login" className="w-full">
                    <LogIn className="mr-2 h-4 w-4" /> Log In or Sign Up
                </Link>
            </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
