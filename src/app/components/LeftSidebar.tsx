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
import { useEffect, useState } from 'react';
import { ACTIVITY_ROOM_ID } from '@/lib/watch-session';

interface Room {
    id: string;
    name: string;
    isPrivate: boolean;
}

function DSHLiveUsers() {
  const [liveUsers, setLiveUsers] = useState<Array<{ id: string; username: string; twitchLogin: string; avatarUrl: string | null; group: string }>>([]);

  useEffect(() => {
    const fetchLive = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const dshUrl = process.env.NEXT_PUBLIC_DSH_URL || 'https://discord-stream-hub-new.fly.dev';
        const res = await fetch(`${dshUrl}/api/community-online`, { cache: 'no-store', signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setLiveUsers(data.users || []);
        }
      } catch {
      } finally {
        window.clearTimeout(timeout);
      }
    };
    fetchLive();
    const iv = setInterval(fetchLive, 30_000);
    return () => clearInterval(iv);
  }, []);

  if (!liveUsers.length) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-red-400"><span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse mr-1" />Live on Twitch</SidebarGroupLabel>
      <div className="px-2">
        <div className="flex flex-wrap gap-1">
          {liveUsers.slice(0, 12).map(u => (
            <Tooltip key={u.id}>
              <TooltipTrigger asChild>
                <a href={`https://twitch.tv/${u.twitchLogin}`} target="_blank" rel="noreferrer">
                  <Avatar className="h-6 w-6 border-2 border-red-500/60">
                    {u.avatarUrl ? <AvatarImage src={u.avatarUrl} /> : null}
                    <AvatarFallback className="text-[9px]">{(u.username || '?').charAt(0)}</AvatarFallback>
                  </Avatar>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right"><p>{u.username} • {u.group}</p></TooltipContent>
            </Tooltip>
          ))}
          {liveUsers.length > 12 && <span className="text-[10px] text-muted-foreground self-center">+{liveUsers.length - 12}</span>}
        </div>
      </div>
    </SidebarGroup>
  );
}

function HMOOnlineUsers() {
  const [onlineUsers, setOnlineUsers] = useState<Array<{ id: string; username: string; photoURL: string | null; roomName: string; roomId: string }>>([]);

  useEffect(() => {
    const fetchOnline = async () => {
      try {
        const res = await fetch('/api/community-online', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setOnlineUsers(data.users || []);
        }
      } catch {}
    };
    fetchOnline();
    const iv = setInterval(fetchOnline, 5000);
    return () => clearInterval(iv);
  }, []);

  if (!onlineUsers.length) return null;

  const usersByRoom = onlineUsers.reduce<Record<string, typeof onlineUsers>>((rooms, user) => {
    const key = user.roomId || user.roomName || 'room';
    rooms[key] = rooms[key] || [];
    rooms[key].push(user);
    return rooms;
  }, {});

  return (
    <SidebarGroup>
      <SidebarGroupLabel><Users className="h-3 w-3 mr-1" />In Rooms</SidebarGroupLabel>
      <div className="px-2">
        {Object.entries(usersByRoom).map(([roomKey, users]) => (
          <div key={roomKey} className="mb-2">
            <p className="text-[10px] text-muted-foreground font-medium mb-1 truncate">{users[0]?.roomName || roomKey}</p>
            <div className="flex flex-wrap gap-1">
              {users.slice(0, 8).map((u) => (
                <Tooltip key={`${u.roomId}-${u.id}`}>
                  <TooltipTrigger asChild>
                    <Avatar className="h-6 w-6 border-2 border-green-500/60">
                      {u.photoURL ? <AvatarImage src={u.photoURL} /> : null}
                      <AvatarFallback className="text-[9px]">{(u.username || '?').charAt(0)}</AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>{u.username || 'User'}</p></TooltipContent>
                </Tooltip>
              ))}
              {users.length > 8 && <span className="text-[10px] text-muted-foreground self-center">+{users.length - 8}</span>}
            </div>
          </div>
        ))}
      </div>
    </SidebarGroup>
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
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={roomId === ACTIVITY_ROOM_ID}>
                <Link href={`/rooms/${ACTIVITY_ROOM_ID}`}><Music />Discord Activity</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
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

        {/* Live on Twitch (from DiscordStreamHub) */}
        <DSHLiveUsers />

        {/* Active users across rooms */}
        <HMOOnlineUsers />
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
