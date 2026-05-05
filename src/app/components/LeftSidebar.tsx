'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarGroup, SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Home, Music, LogOut, Settings, User, LogIn, Users, ExternalLink } from 'lucide-react';
import { Logo } from '@/app/components/Logo';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from '@/hooks/use-session';
import { useCollection } from '@/hooks/use-db';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateRoomDialog } from '@/app/rooms/_components/CreateRoomDialog';
import { useEffect } from 'react';

interface Room {
    id: string;
    name: string;
    isPrivate: boolean;
}

function RoomOnlineUsers({ roomId, roomName }: { roomId: string; roomName: string }) {
  const { data: users } = useCollection<{ displayName?: string; photoURL?: string; lastSeen?: number }>(`rooms/${roomId}/users`);
  const activeUsers = (users || []).filter((u: any) => {
    const lastSeen = Number(u?.lastSeen || 0);
    return lastSeen > 0 && Date.now() - lastSeen < 45000;
  });
  if (!activeUsers.length) return null;
  return (
    <div className="mb-2">
      <p className="text-[10px] text-muted-foreground font-medium mb-1 truncate">{roomName}</p>
      <div className="flex flex-wrap gap-1">
        {activeUsers.slice(0, 8).map((u: any) => (
          <Tooltip key={u.id}>
            <TooltipTrigger asChild>
              <Avatar className="h-6 w-6 border-2 border-green-500/60">
                <AvatarImage src={u.photoURL} />
                <AvatarFallback className="text-[9px]">{(u.displayName || '?').charAt(0)}</AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{u.displayName || 'User'}</p></TooltipContent>
          </Tooltip>
        ))}
        {activeUsers.length > 8 && <span className="text-[10px] text-muted-foreground self-center">+{activeUsers.length - 8}</span>}
      </div>
    </div>
  );
}

export default function LeftSidebar({ roomId }: { roomId?: string }) {
  const pathname = usePathname();
  const { user, isLoading: isUserLoading, logout } = useSession();

  const { data: publicRooms, isLoading: roomsLoading } = useCollection<Room>('rooms', {
    filters: [{ field: 'isPrivate', op: '==', value: false }],
  });

  useEffect(() => {
    const prune = () => {
      fetch('/api/presence/prune', { method: 'POST' }).catch(() => {});
    };
    prune();
    const iv = setInterval(prune, 60_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Sidebar>
      <SidebarHeader>
        <Logo />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/'}>
              <Link href="/"><Home />Home</Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="https://discord-stream-hub-new.fly.dev" target="_blank" rel="noopener noreferrer">
                <ExternalLink />Stream Hub
              </a>
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
                  <Link href={`/rooms/${room.id}`}><Music />{room.name}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
             {!roomsLoading && (!publicRooms || publicRooms.length === 0) && (
              <p className="px-2 text-sm text-muted-foreground">No public rooms yet.</p>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/* Active users across rooms */}
        {publicRooms && publicRooms.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel><Users className="h-3 w-3 mr-1" />Online Now</SidebarGroupLabel>
            <div className="px-2">
              {publicRooms.map(room => (
                <RoomOnlineUsers key={room.id} roomId={room.id} roomName={room.name} />
              ))}
            </div>
          </SidebarGroup>
        )}
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
                        <AvatarImage src={user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`} alt="User Avatar" />
                        <AvatarFallback>{user.isAnonymous ? 'G' : user.displayName?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col flex-1 overflow-hidden">
                        <p className="text-sm font-medium leading-none truncate">{user.isAnonymous ? 'Guest User' : user.displayName || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground truncate">
                            {user.email || (user.isAnonymous ? 'guest@hearmeout.com' : 'Space Mountain')}
                        </p>
                    </div>
                </div>
                <div className='flex gap-2'>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" className='flex-1' disabled={user.isAnonymous}>
                                <User/><span className='sr-only'>Profile</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Profile</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" asChild className='flex-1'>
                                <Link href="/settings"><Settings/><span className='sr-only'>Settings</span></Link>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Settings</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={logout} className='flex-1'>
                                <LogOut /><span className='sr-only'>Log out</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Log out</p></TooltipContent>
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
