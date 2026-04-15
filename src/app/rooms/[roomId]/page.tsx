'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LiveKitRoom, useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from "@/components/ui/button";
import { Copy, MessageSquare, X, LoaderCircle, Music, FrameIcon } from 'lucide-react';
import LeftSidebar from '@/app/components/LeftSidebar';
import UserList from './_components/UserList';
import ChatBox from './_components/ChatBox';
import MusicPlayerCard from './_components/MusicPlayerCard';
import PlaylistPanel from './_components/PlaylistPanel';
import AddMusicPanel from './_components/AddMusicPanel';
import VoiceQueue from './_components/VoiceQueue';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbUpdate, dbSet } from '@/lib/db-helpers';
import { generateLiveKitToken, postToDiscord } from '@/app/actions';
import { PlaylistItem } from "@/types/playlist";
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { dbGet } from '@/lib/db-helpers';

interface RoomData {
  id: string;
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djId?: string;
  djDisplayName?: string;
}

function RoomHeader({ roomName, onToggleChat, isDJ, onClaimDJ, onRelinquishDJ, isOwner, onOpenChatWidget }: {
    roomName: string; onToggleChat: () => void; isDJ: boolean; onClaimDJ: () => void; onRelinquishDJ: () => void; isOwner: boolean; onOpenChatWidget: () => void;
}) {
    const { isMobile } = useSidebar();
    const params = useParams();
    const { toast } = useToast();

    const copyOverlayUrl = () => {
        navigator.clipboard.writeText(`${window.location.origin}/overlay/${params.roomId}`);
        toast({ title: "Overlay URL Copied!", description: "You can now paste this into your streaming software." });
    };

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className={isMobile ? "" : "hidden md:flex"} />
            <div className="flex-1 flex items-center gap-4 truncate">
                <h2 className="text-xl font-bold font-headline truncate">{roomName}</h2>
                <ConnectionStatusIndicator />
            </div>
            <div className="flex flex-initial items-center justify-end space-x-2">
                <Tooltip><TooltipTrigger asChild>
<Button variant="outline" size="icon" onClick={isDJ ? onRelinquishDJ : onClaimDJ}><Music className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>{isDJ ? 'Stop being the DJ' : 'Become the DJ'}</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={onOpenChatWidget}><MessageSquare className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>Pop-out Chat Widget</p></TooltipContent></Tooltip>
                {isOwner && (
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="icon" onClick={copyOverlayUrl}><Copy className="h-4 w-4" /></Button>
                    </TooltipTrigger><TooltipContent><p>Copy Overlay URL</p></TooltipContent></Tooltip>
                )}
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={onToggleChat}><FrameIcon className="h-5 w-5" /></Button>
                </TooltipTrigger><TooltipContent><p>Toggle Chat Sidebar</p></TooltipContent></Tooltip>
            </div>
        </header>
    );
}

function ConnectionStatusIndicator() {
    const connectionState = useConnectionState();
    let indicatorClass = 'bg-gray-500';
    let statusText = 'Unknown';
    switch (connectionState) {
        case ConnectionState.Connected: indicatorClass = 'bg-green-500'; statusText = 'Connected'; break;
        case ConnectionState.Connecting: indicatorClass = 'bg-yellow-500 animate-pulse'; statusText = 'Connecting'; break;
        case ConnectionState.Disconnected: indicatorClass = 'bg-red-500'; statusText = 'Disconnected'; break;
        case ConnectionState.Reconnecting: indicatorClass = 'bg-yellow-500 animate-pulse'; statusText = 'Reconnecting'; break;
    }
    return (
        <Tooltip><TooltipTrigger><div className={cn("h-2.5 w-2.5 rounded-full", indicatorClass)} /></TooltipTrigger>
        <TooltipContent><p>Voice: {statusText}</p></TooltipContent></Tooltip>
    );
}

function RoomContent({ room, roomId }: { room: RoomData; roomId: string }) {
    const { user, isLoading: isUserLoading } = useSession();
    const { toast } = useToast();
    const { openPopout } = usePopout();
    const router = useRouter();
    const [chatOpen, setChatOpen] = useState(false);
    const [voiceToken, setVoiceToken] = useState<string | undefined>(undefined);
    const [activePanels, setActivePanels] = useState({ playlist: true, add: true });
    const [localVolume, setLocalVolume] = useState(0.5);

const { data: userSettings } = useDoc<{ streamMode?: boolean; twitchChannel?: string }>(
      user ? `rooms/${roomId}/users` : null,
      user?.uid || null,
    );

    const isDJ = !!user && !!room.djId && user.uid === room.djId;
    const isAdmin = !!user && !!(user as any).isAdmin;
    const isOwner = !!user && (user.uid === room.ownerId || isAdmin);

    // Check if user is banned from this room
    const [isBanned, setIsBanned] = React.useState(false);
    useEffect(() => {
      if (!user || !roomId) return;
      dbGet(`rooms/${roomId}/banned`, user.uid).then(data => { if (data) setIsBanned(true); });
    }, [user, roomId]);

    // Poll for move instructions (admin moved us to another room)
    useEffect(() => {
      if (!user || !roomId) return;
      const checkMove = async () => {
        const move = await dbGet(`rooms/${roomId}/moves`, user.uid);
        if (move?.targetRoomId) {
          fetch('/api/db', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: `rooms/${roomId}/moves`, id: user.uid }) }).catch(() => {});
          toast({ title: 'Moved!', description: `You've been moved to ${move.targetRoomName || 'another room'}.` });
          router.push(`/rooms/${move.targetRoomId}`);
        }
      };
      const interval = setInterval(checkMove, 3000);
      return () => clearInterval(interval);
    }, [user, roomId, room, router, toast]);

    if (isBanned) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <h3 className="text-2xl font-bold font-headline mb-4">You are banned from this room</h3>
          <p className="text-muted-foreground mb-8">Contact the room owner if you think this is a mistake.</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      );
    }

    const handleClaimDJ = useCallback(() => {
        if (!user) { toast({ variant: 'destructive', title: 'Authentication Error', description: 'You must be signed in to become the DJ.' }); return; }
        dbUpdate('rooms', roomId, { djId: user.uid, djDisplayName: user.displayName || 'Anonymous DJ' });
    }, [user, roomId, toast]);

    const handleRelinquishDJ = useCallback(() => {
        if (!isDJ) return;
        dbUpdate('rooms', roomId, { djId: '', djDisplayName: '', isPlaying: false });
    }, [roomId, isDJ]);

    useEffect(() => {
        if (isUserLoading || !user || !roomId) return;
        if (voiceToken) return; // Don't regenerate if we already have a token
        
        let isCancelled = false;

        const setup = async () => {
            dbSet(`rooms/${roomId}/users`, user.uid, {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`,
            }, true);

            try {
                const token = await generateLiveKitToken(roomId, user.uid, user.displayName!, JSON.stringify({ photoURL: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100` }));
                if (!isCancelled) setVoiceToken(token);
            } catch (e) {
                if (!isCancelled) toast({ variant: 'destructive', title: 'Connection Failed', description: `Could not get voice connection: ${e instanceof Error ? e.message : String(e)}` });
            }
        };
        setup();
        return () => { isCancelled = true; };
    }, [user, isUserLoading, roomId, toast]); // Removed voiceToken from dependencies

    const currentTrack = room.playlist?.find((t: any) => t.id === room.currentTrackId);

    const handlePlayNext = useCallback(() => {
        if (!isDJ) return;
        const { playlist, currentTrackId } = room;
        if (!playlist || playlist.length === 0) return;
        const nextIndex = (playlist.findIndex((t: any) => t.id === currentTrackId) + 1) % playlist.length;
        dbUpdate('rooms', roomId, { currentTrackId: playlist[nextIndex].id, isPlaying: true });
    }, [room, roomId, isDJ]);

    const handlePlayPrev = useCallback(() => {
        if (!isDJ) return;
        const { playlist, currentTrackId } = room;
        if (!playlist || playlist.length === 0) return;
        const prevIndex = (playlist.findIndex((t: any) => t.id === currentTrackId) - 1 + playlist.length) % playlist.length;
        dbUpdate('rooms', roomId, { currentTrackId: playlist[prevIndex].id, isPlaying: true });
    }, [room, roomId, isDJ]);

    const handlePlaySong = useCallback((songId: string) => { if (isDJ) dbUpdate('rooms', roomId, { currentTrackId: songId, isPlaying: true }); }, [roomId, isDJ]);
    const handleRemoveSong = useCallback((songId: string) => { if (!isDJ) return; dbUpdate('rooms', roomId, { playlist: room.playlist.filter((s: any) => s.id !== songId) }); }, [room, roomId, isDJ]);
    const handleClearPlaylist = useCallback(() => { if (isDJ) dbUpdate('rooms', roomId, { playlist: [], currentTrackId: '', isPlaying: false }); }, [roomId, isDJ]);
    const handlePlayPause = useCallback((playing: boolean) => { if (isDJ) dbUpdate('rooms', roomId, { isPlaying: playing }); }, [roomId, isDJ]);

    const handleAddItems = useCallback((items: PlaylistItem[]) => {
        if (!isDJ) return;
        const newPlaylist = [...(room.playlist || []), ...items];
        const updates: any = { playlist: newPlaylist };
        if ((!room.isPlaying || !room.currentTrackId) && items.length > 0) { updates.currentTrackId = items[0].id; updates.isPlaying = true; }
        dbUpdate('rooms', roomId, updates);
    }, [room, roomId, isDJ]);

    const handlePostToDiscord = useCallback(async () => {
        if (!user) { toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in.' }); return; }
        try {
            const userData = await dbGet(`rooms/${roomId}/users`, user.uid);
            if (!userData?.discordGuildId) { toast({ variant: 'destructive', title: 'Discord Not Configured', description: 'Set your Discord server ID in your user card menu first.' }); return; }
            const channelId = userData.discordSelectedChannel;
            if (!channelId) { toast({ variant: 'destructive', title: 'No Channel Selected', description: 'Select a channel in the chat widget first.' }); return; }
            await postToDiscord(channelId, roomId, room?.name || 'HearMeOut Room');
            toast({ title: "Posted to Discord!", description: `Control embed sent to selected channel` });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Discord Error", description: error.message || "Could not post to Discord." });
        }
    }, [user, roomId, toast]);

    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!livekitUrl || !voiceToken) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                <h3 className="text-2xl font-bold font-headline mb-4">Voice Chat Unavailable</h3>
                <p className="text-muted-foreground mb-8 max-w-sm">Voice features are temporarily disabled. You can still use text chat and music features.</p>
            </div>
        );
    }

    return (
      <LiveKitRoom serverUrl={livekitUrl} token={voiceToken} connect={true} audio={!userSettings?.streamMode} video={false}
          options={{ autoSubscribe: true, dynacast: true, adaptiveStream: true }}
          onError={(err) => { toast({ variant: 'destructive', title: 'Connection Error', description: err.message }); }}>
        <div className={cn("bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right]", chatOpen && "md:mr-[28rem]")}>
            <SidebarInset>
                <div className="flex flex-col h-screen relative">
                    <RoomHeader roomName={room.name} onToggleChat={() => setChatOpen(!chatOpen)} isDJ={isDJ} onClaimDJ={handleClaimDJ} onRelinquishDJ={handleRelinquishDJ} isOwner={isOwner} onOpenChatWidget={() => openPopout('chat', { width: 450, height: 600 })} />
                    <main className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
                        {isDJ ? (
                            <div className="flex flex-col lg:flex-row gap-6">
                                <div className="lg:w-1/3 shrink-0">
                                    <MusicPlayerCard currentTrack={currentTrack} playing={!!room.isPlaying} isPlayerControlAllowed={true} onPlayPause={handlePlayPause} onPlayNext={handlePlayNext} onPlayPrev={handlePlayPrev} onTogglePanel={(panel) => setActivePanels(p => ({ ...p, [panel]: !p[panel] }))} activePanels={activePanels} volume={localVolume} onVolumeChange={setLocalVolume} isDJ={isDJ} roomId={roomId} />
                                </div>
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                    {activePanels.playlist && <div className={cn({ 'md:col-span-2': !activePanels.add })}><PlaylistPanel playlist={room.playlist || []} currentTrackId={room.currentTrackId || ''} isPlayerControlAllowed={true} onPlaySong={handlePlaySong} onRemoveSong={handleRemoveSong} onClearPlaylist={handleClearPlaylist} /></div>}
                                    {activePanels.add && <div className={cn({ 'md:col-span-2': !activePanels.playlist })}><AddMusicPanel onAddItems={handleAddItems} onClose={() => {}} canAddMusic={true} /></div>}
                                </div>
                            </div>
                        ) : room.djDisplayName ? (
                            <div className="text-center text-muted-foreground py-16">
                                <h3 className="text-xl font-semibold">{room.djDisplayName} is the DJ</h3>
                                <p className="mt-2">Sit back and enjoy the music!</p>
                            </div>
                        ) : null}
                        <UserList roomId={roomId} />
                        {(isDJ || isOwner) && <VoiceQueue roomId={roomId} />}
                    </main>
                </div>
            </SidebarInset>
        </div>
        <div className={cn("fixed inset-y-0 right-0 z-40 w-full sm:max-w-md transform transition-transform duration-300 ease-in-out bg-card border-l", chatOpen ? "translate-x-0" : "translate-x-full")}>
            <div className="relative h-full">
                <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} className="absolute top-4 right-4 z-50 md:hidden"><X className="h-5 w-5" /></Button>
                <ChatBox />
            </div>
        </div>
      </LiveKitRoom>
    );
}

function RoomPageContent() {
    const params = useParams<{ roomId: string }>();
    const { user, isLoading: isUserLoading } = useSession();
    const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<RoomData>('rooms', params.roomId, 2000);

    if (isRoomLoading || !room) {
        return (
            <div className="flex flex-col h-screen">
                <LeftSidebar roomId={params.roomId} />
                <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right] flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-muted-foreground">Loading room...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (roomError) {
        return (
            <div className="flex flex-col h-screen">
                <LeftSidebar roomId={params.roomId} />
                <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right] flex-1 flex flex-col items-center justify-center gap-4 text-center">
                    <h2 className="text-2xl font-bold">Room not found</h2>
                    <p className="text-muted-foreground">{roomError?.message || "This room may have been deleted."}</p>
                    <Button asChild><a href="/">Go to Dashboard</a></Button>
                </div>
            </div>
        );
    }

    return (
        <>
            <LeftSidebar roomId={params.roomId} />
            <RoomContent room={room} roomId={params.roomId} />
        </>
    );
}

export default function RoomPage() {
    return <SidebarProvider><RoomPageContent /></SidebarProvider>;
}
