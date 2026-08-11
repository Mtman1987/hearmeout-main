'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarGroup, SidebarGroupLabel, SidebarRail,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Home, Music, LogOut, Settings, User, LogIn, Users, ExternalLink, MessageSquare } from 'lucide-react';
import { Logo } from '@/app/components/Logo';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from '@/hooks/use-session';
import { useCollection } from '@/hooks/use-db';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateRoomDialog } from '@/app/rooms/_components/CreateRoomDialog';
import { useEffect, useState } from 'react';
import { ACTIVITY_ROOM_ID, ACTIVITY_ROOM_NAME } from '@/lib/watch-session';

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
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="text-red-400"><span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />Live on Twitch</SidebarGroupLabel>
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
          {liveUsers.length > 12 && <span className="self-center text-[10px] text-muted-foreground">+{liveUsers.length - 12}</span>}
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
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel><Users className="mr-1 h-3 w-3" />In Rooms</SidebarGroupLabel>
      <div className="px-2">
        {Object.entries(usersByRoom).map(([roomKey, users]) => (
          <div key={roomKey} className="mb-2">
            <p className="mb-1 truncate text-[10px] font-medium text-muted-foreground">{users[0]?.roomName || roomKey}</p>
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
              {users.length > 8 && <span className="self-center text-[10px] text-muted-foreground">+{users.length - 8}</span>}
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
  const visiblePublicRooms = publicRooms?.filter((room) => room.id !== ACTIVITY_ROOM_ID);

  useEffect(() => {
    const prune = () => {
      fetch('/api/presence/prune', { method: 'POST' }).catch(() => {});
    };
    prune();
    const iv = setInterval(prune, 60_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Sidebar collapsible="icon" data-workspace-sidebar>
      <SidebarHeader className="group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-2">
        <Logo />
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:px-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/'} tooltip="Home">
              <Link href="/"><Home />Home</Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === '/messages'} tooltip="Messages">
              <Link href="/messages"><MessageSquare />Messages</Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Discord Stream Hub">
              <a href="https://discord-stream-hub-new.fly.dev" target="_blank" rel="noopener noreferrer">
                <ExternalLink />Stream Hub
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarGroup className="group-data-[collapsible=icon]:px-0">
          <SidebarGroupLabel>Public Rooms</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={roomId === ACTIVITY_ROOM_ID} tooltip={ACTIVITY_ROOM_NAME}>
                <Link href={`/rooms/${ACTIVITY_ROOM_ID}`}><Music />{ACTIVITY_ROOM_NAME}</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {roomsLoading && (
                <div className="space-y-2 group-data-[collapsible=icon]:hidden">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            )}
            {visiblePublicRooms && visiblePublicRooms.map(room => (
              <SidebarMenuItem key={room.id}>
                <SidebarMenuButton asChild isActive={room.id === roomId} tooltip={room.name}>
                  <Link href={`/rooms/${room.id}`}><Music />{room.name}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
             {!roomsLoading && (!visiblePublicRooms || visiblePublicRooms.length === 0) && (
              <p className="px-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">No other public rooms yet.</p>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <DSHLiveUsers />
        <HMOOnlineUsers />
      </SidebarContent>
      <SidebarFooter className="gap-4 group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-1">
        <div className="group-data-[collapsible=icon]:hidden">
          <CreateRoomDialog />
        </div>
        <div className="-mx-2 border-t group-data-[collapsible=icon]:hidden"></div>

        {isUserLoading ? (
            <div className="space-y-2 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center gap-3 rounded-md p-2">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2 overflow-hidden">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                  </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 flex-1" />
              </div>
            </div>
        ) : user ? (
            <>
                <div className="flex items-center gap-3 rounded-md p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
                    <Avatar className="h-9 w-9 shrink-0 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
                        <AvatarImage src={user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`} alt="User Avatar" />
                        <AvatarFallback>{user.isAnonymous ? 'G' : user.displayName?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-1 flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
                        <p className="truncate text-sm font-medium leading-none">{user.isAnonymous ? 'Guest User' : user.displayName || 'User'}</p>
                        <p className="truncate text-xs leading-none text-muted-foreground">
                            {user.email || (user.isAnonymous ? 'guest@hearmeout.com' : 'Space Mountain')}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" className="flex-1 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:flex-none" disabled={user.isAnonymous}>
                                <User/><span className="sr-only">Profile</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>Profile</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" asChild className="flex-1 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:flex-none">
                                <Link href="/settings"><Settings/><span className="sr-only">Settings</span></Link>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>Settings</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={logout} className="flex-1 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:flex-none">
                                <LogOut /><span className="sr-only">Log out</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>Log out</p></TooltipContent>
                    </Tooltip>
                </div>
            </>
        ) : (
            <Button asChild className="group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0">
                <Link href="/login" className="w-full group-data-[collapsible=icon]:justify-center">
                    <LogIn className="h-4 w-4 group-data-[collapsible=icon]:mr-0" /> <span className="group-data-[collapsible=icon]:hidden">Log In or Sign Up</span>
                </Link>
            </Button>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}