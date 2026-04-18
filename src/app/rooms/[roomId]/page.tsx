'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LiveKitRoom, useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from "@/components/ui/button";
import { Copy, MessageSquare, X, LoaderCircle, FrameIcon, Music } from 'lucide-react';
import LeftSidebar from '@/app/components/LeftSidebar';
import UserList from './_components/UserList';
import ChatBox from './_components/ChatBox';
import PlaylistPanel from './_components/PlaylistPanel';
import AddMusicPanel from './_components/AddMusicPanel';
import VoiceQueue from './_components/VoiceQueue';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbUpdate, dbSet } from '@/lib/db-helpers';
import { generateLiveKitToken, generateMusicRoomToken } from '@/app/actions';
import { PlaylistItem } from "@/types/playlist";
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { dbGet } from '@/lib/db-helpers';
import { Room as LKRoom, RoomEvent, Track, RemoteTrack } from 'livekit-client';

interface RoomData {
  id: string;
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
}

function RoomHeader({ roomName, onToggleChat, onOpenChatWidget, showDJ, onToggleDJ }: {
    roomName: string; onToggleChat: () => void; onOpenChatWidget: () => void; showDJ: boolean; onToggleDJ: () => void;
}) {
    const { isMobile } = useSidebar();
    const params = useParams();
    const { toast } = useToast();

    const copyOverlayUrl = () => {
        navigator.clipboard.writeText(`${window.location.origin}/overlay/${params.roomId}`);
        toast({ title: "Overlay URL Copied!", description: "Paste this into OBS as a browser source." });
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
                    <Button variant={showDJ ? "secondary" : "outline"} size="icon" onClick={onToggleDJ}><Music className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>{showDJ ? 'Hide DJ' : 'Show DJ'}</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={onOpenChatWidget}><MessageSquare className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>Pop-out Chat Widget</p></TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={copyOverlayUrl}><Copy className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>Copy Overlay URL for OBS</p></TooltipContent></Tooltip>
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
    const [localVolume, setLocalVolume] = useState(0.5);
    const [musicStatus, setMusicStatus] = useState<string | null>(null);
    const [musicExpanded, setMusicExpanded] = useState(false);
    const [showDJ, setShowDJ] = useState(true);

    const { data: userSettings } = useDoc<{ streamMode?: boolean; twitchChannel?: string }>(
      user ? `rooms/${roomId}/users` : null,
      user?.uid || null,
    );

    const isAdmin = !!user && !!(user as any).isAdmin;
    const isOwner = !!user && (user.uid === room.ownerId || isAdmin);
    const canControl = !!user;

    const musicRoomRef = useRef<LKRoom | null>(null);
    const musicAudioRef = useRef<HTMLAudioElement | null>(null);
    const localVolumeRef = useRef(localVolume);
    useEffect(() => { localVolumeRef.current = localVolume; }, [localVolume]);

    // Connect to LiveKit Music Room as subscriber.
    // The room owner/DJ already hears the music locally from /dj/[roomId]
    // (WebAudio monitor). Subscribing here too would cause double playback,
    // so owners skip this subscription entirely.
    useEffect(() => {
        if (isUserLoading || !user || !roomId) return;
        if (isOwner) {
            setMusicStatus('hosting (monitor on DJ tab)');
            return;
        }
        let cancelled = false;

        const connectMusicRoom = async () => {
            try {
                console.log('[MusicRoom] Connecting as listener...');
                const token = await generateMusicRoomToken(roomId, user.uid, user.displayName || 'Listener', false);
                const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
                if (!livekitUrl || cancelled) return;

                const lkRoom = new LKRoom();
                await lkRoom.connect(livekitUrl, token);
                if (cancelled) { lkRoom.disconnect(); return; }
                musicRoomRef.current = lkRoom;
                console.log('[MusicRoom] Connected! Participants:', lkRoom.remoteParticipants.size);
                setMusicStatus('connected');

                const attachTrack = (track: RemoteTrack) => {
                    if (track.kind === Track.Kind.Audio) {
                        console.log('[MusicRoom] 🎵 Audio track received — attaching');
                        if (!musicAudioRef.current) musicAudioRef.current = new Audio();
                        track.attach(musicAudioRef.current);
                        musicAudioRef.current.volume = localVolumeRef.current;
                        musicAudioRef.current.play().catch(e => console.warn('[MusicRoom] Autoplay blocked:', e));
                        setMusicStatus('🎵 streaming');
                    }
                };

                lkRoom.remoteParticipants.forEach(p => {
                    console.log('[MusicRoom] Remote participant:', p.identity, 'tracks:', p.trackPublications.size);
                    p.trackPublications.forEach(pub => {
                        if (pub.track && pub.isSubscribed) attachTrack(pub.track as RemoteTrack);
                    });
                });

                lkRoom.on(RoomEvent.TrackSubscribed, (track) => {
                    console.log('[MusicRoom] TrackSubscribed:', track.kind, track.source);
                    attachTrack(track);
                });
                lkRoom.on(RoomEvent.TrackUnsubscribed, () => {
                    console.log('[MusicRoom] Track unsubscribed');
                    if (musicAudioRef.current) { musicAudioRef.current.srcObject = null; }
                    setMusicStatus('connected');
                });
                lkRoom.on(RoomEvent.ParticipantConnected, (p) => {
                    console.log('[MusicRoom] Participant joined:', p.identity);
                });
            } catch (err) {
                console.error('[MusicRoom] Connection error:', err);
                setMusicStatus('error');
            }
        };

        connectMusicRoom();
        return () => {
            cancelled = true;
            musicRoomRef.current?.disconnect();
            musicRoomRef.current = null;
            if (musicAudioRef.current) { musicAudioRef.current.srcObject = null; }
        };
    }, [user, isUserLoading, roomId, isOwner]);

    // Sync volume changes to the audio element
    useEffect(() => {
        if (musicAudioRef.current) musicAudioRef.current.volume = localVolume;
    }, [localVolume]);

    // Check if user is banned
    const [isBanned, setIsBanned] = React.useState(false);
    useEffect(() => {
      if (!user || !roomId) return;
      dbGet(`rooms/${roomId}/banned`, user.uid).then(data => { if (data) setIsBanned(true); });
    }, [user, roomId]);

    // Poll for move instructions
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
    }, [user, roomId, router, toast]);

    useEffect(() => {
        if (isUserLoading || !user || !roomId) return;
        if (voiceToken) return;
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
    }, [user, isUserLoading, roomId, toast]);

    const handlePlaySong = useCallback((songId: string) => { if (canControl) dbUpdate('rooms', roomId, { currentTrackId: songId, isPlaying: true }); }, [roomId, canControl]);
    const handleRemoveSong = useCallback((songId: string) => {
        dbUpdate('rooms', roomId, { playlist: room.playlist.filter((s: any) => s.id !== songId) });
    }, [room, roomId]);
    const handleClearPlaylist = useCallback(() => { dbUpdate('rooms', roomId, { playlist: [], currentTrackId: '', isPlaying: false }); }, [roomId]);

    const handleAddItems = useCallback((items: PlaylistItem[]) => {
        if (!canControl) return;
        const newPlaylist = [...(room.playlist || []), ...items];
        const updates: any = { playlist: newPlaylist };
        if ((!room.isPlaying || !room.currentTrackId) && items.length > 0) { updates.currentTrackId = items[0].id; updates.isPlaying = true; }
        dbUpdate('rooms', roomId, updates);
    }, [room, roomId, canControl]);

    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (isBanned) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <h3 className="text-2xl font-bold font-headline mb-4">You are banned from this room</h3>
          <p className="text-muted-foreground mb-8">Contact the room owner if you think this is a mistake.</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      );
    }

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
          options={{ dynacast: true, adaptiveStream: true }}
          onError={(err) => { toast({ variant: 'destructive', title: 'Connection Error', description: err.message }); }}>
        <div className={cn("bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right]", chatOpen && "md:mr-[28rem]")}>
            <SidebarInset>
                <div className="flex flex-col h-screen relative">
                    <RoomHeader roomName={room.name} onToggleChat={() => setChatOpen(!chatOpen)} onOpenChatWidget={() => openPopout('chat', { width: 450, height: 600 })} showDJ={showDJ} onToggleDJ={() => setShowDJ(v => !v)} />

                    {/* Playlist toggle bar */}
                    <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-sm border-b">
                        <div className="flex items-center justify-between px-4 h-10">
                            <p className="text-sm text-muted-foreground">
                                {room.playlist?.length ? `${room.playlist.length} song${room.playlist.length > 1 ? 's' : ''} in queue` : 'No songs in queue'}
                            </p>
                            <Button variant="ghost" size="sm" onClick={() => setMusicExpanded(v => !v)}>
                                {musicExpanded ? 'Hide Queue' : 'Show Queue'}
                            </Button>
                        </div>
                        {musicExpanded && (
                            <div className="absolute left-0 right-0 top-10 z-50 bg-background border-b shadow-lg max-h-[60vh] overflow-y-auto">
                                <div className="p-4 space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <PlaylistPanel playlist={room.playlist || []} currentTrackId={room.currentTrackId || ''} isPlayerControlAllowed={canControl} onPlaySong={handlePlaySong} onRemoveSong={handleRemoveSong} onClearPlaylist={handleClearPlaylist} />
                                        {canControl && <AddMusicPanel onAddItems={handleAddItems} onClose={() => setMusicExpanded(false)} canAddMusic={true} />}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    {musicExpanded && <div className="fixed inset-0 z-10" onClick={() => setMusicExpanded(false)} />}

                    <main className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
                        <UserList
                          roomId={roomId}
                          musicStatus={musicStatus}
                          localVolume={localVolume}
                          onVolumeChange={setLocalVolume}
                          showDJ={showDJ}
                        />
                        {isOwner && <VoiceQueue roomId={roomId} />}
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
