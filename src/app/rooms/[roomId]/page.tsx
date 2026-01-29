'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  LiveKitRoom,
  useConnectionState,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, createLocalAudioTrack, Track } from 'livekit-client';
import * as LivekitClient from 'livekit-client';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from "@/components/ui/button";
import { Copy, MessageSquare, X, LoaderCircle, Headphones, Music, FrameIcon } from 'lucide-react';
import LeftSidebar from '@/app/components/LeftSidebar';
import UserList from './_components/UserList';
import ChatBox from './_components/ChatBox';
import MusicPlayerCard from './_components/MusicPlayerCard';
import PlaylistPanel from './_components/PlaylistPanel';
import MusicStreamerCard from './_components/MusicStreamerCard';
import AddMusicPanel from './_components/AddMusicPanel';
import VoiceQueue from './_components/VoiceQueue';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFirebase, useDoc, useMemoFirebase, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { generateLiveKitToken, postToDiscord } from '@/app/actions';
import { PlaylistItem } from "@/types/playlist";
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';


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

function RoomHeader({
    roomName,
    onToggleChat,
    isDJ,
    onClaimDJ,
    onRelinquishDJ,
    isOwner,
    onOpenChatWidget,
}: {
    roomName: string,
    onToggleChat: () => void,
    isDJ: boolean,
    onClaimDJ: () => void,
    onRelinquishDJ: () => void;
    isOwner: boolean;
    onOpenChatWidget: () => void;
}) {
    const { isMobile } = useSidebar();
    const params = useParams();
    const { toast } = useToast();

    const copyOverlayUrl = () => {
        const url = `${window.location.origin}/overlay/${params.roomId}`;
        navigator.clipboard.writeText(url);
        toast({
            title: "Overlay URL Copied!",
            description: "You can now paste this into your streaming software.",
        });
    }

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className={isMobile ? "" : "hidden md:flex"} />

            <div className="flex-1 flex items-center gap-4 truncate">
                <h2 className="text-xl font-bold font-headline truncate">{roomName}</h2>
                <ConnectionStatusIndicator />
            </div>

            <div className="flex flex-initial items-center justify-end space-x-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                         <Button 
                            variant="outline" 
                            size="icon" 
                            onClick={isDJ ? onRelinquishDJ : onClaimDJ}
                            >
                            <Music className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{isDJ ? 'Stop being the DJ' : 'Become the DJ'}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                         <Button 
                            variant="outline" 
                            size="icon" 
                            onClick={onOpenChatWidget}
                            >
                            <MessageSquare className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Pop-out Chat Widget</p>
                    </TooltipContent>
                </Tooltip>

                {isOwner && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={copyOverlayUrl}>
                                <Copy className="h-4 w-4" />
                                <span className="sr-only">Copy Overlay URL</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Copy Overlay URL</p>
                        </TooltipContent>
                    </Tooltip>
                )}
                
                <Tooltip>
                    <TooltipTrigger asChild>
                         <Button variant="outline" size="icon" onClick={() => onToggleChat()}>
                            <FrameIcon className="h-5 w-5" />
                            <span className="sr-only">Toggle Chat Sidebar</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Toggle Chat Sidebar</p>
                    </TooltipContent>
                </Tooltip>
            </div>
        </header>
    );
}

function ConnectionStatusIndicator() {
    const connectionState = useConnectionState();

    let indicatorClass = '';
    let statusText = '';

    switch (connectionState) {
        case ConnectionState.Connected:
            indicatorClass = 'bg-green-500';
            statusText = 'Connected';
            break;
        case ConnectionState.Connecting:
            indicatorClass = 'bg-yellow-500 animate-pulse';
            statusText = 'Connecting';
            break;
        case ConnectionState.Disconnected:
            indicatorClass = 'bg-red-500';
            statusText = 'Disconnected';
            break;
        case ConnectionState.Reconnecting:
            indicatorClass = 'bg-yellow-500 animate-pulse';
            statusText = 'Reconnecting';
            break;
        default:
            indicatorClass = 'bg-gray-500';
            statusText = 'Unknown';
    }

    return (
        <Tooltip>
            <TooltipTrigger>
                <div className={cn("h-2.5 w-2.5 rounded-full", indicatorClass)} />
            </TooltipTrigger>
            <TooltipContent>
                <p>Voice: {statusText}</p>
            </TooltipContent>
        </Tooltip>
    );
}

const DiscordIcon = () => (
    <svg role="img" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M16.29 5.23a10.08 10.08 0 0 0-2.2-.62.84.84 0 0 0-1 .75c.18.25.36.5.52.75a8.62 8.62 0 0 0-4.14 0c.16-.25.34-.5.52-.75a.84.84 0 0 0-1-.75 10.08 10.08 0 0 0-2.2.62.81.81 0 0 0-.54.78c-.28 3.24.78 6.28 2.82 8.25a.85.85 0 0 0 .93.12 7.55 7.55 0 0 0 1.45-.87.82.82 0 0 1 .9-.06 6.53 6.53 0 0 0 2.22 0 .82.82 0 0 1 .9.06 7.55 7.55 0 0 0 1.45.87.85.85 0 0 0 .93-.12c2.04-1.97 3.1-5 2.82-8.25a.81.81 0 0 0-.55-.78zM10 11.85a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 10 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 10 11.85zm4 0a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 14 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 14 11.85z"/>
    </svg>
);

function MusicStreamer({ 
    isDJ, 
    isPlaying, 
    trackUrl,
    onTrackEnd,
    audioRef
} : { 
    isDJ: boolean, 
    isPlaying: boolean, 
    trackUrl?: string, 
    onTrackEnd: () => void,
    audioRef: React.RefObject<HTMLAudioElement>
}) {
    const room = useRoomContext();
    const publicationRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const [audioStreamUrl, setAudioStreamUrl] = useState<string | null>(null);
    const [isFetchingUrl, setIsFetchingUrl] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const retryCountRef = useRef(0);
    const [corsBlocked, setCorsBlocked] = useState(false);

    // Effect 1: Resolve YouTube URL to a direct audio stream URL with retry logic & CORS fallback
    useEffect(() => {
        if (!trackUrl || !isDJ) {
            setAudioStreamUrl(null);
            setAudioError(null);
            setCorsBlocked(false);
            retryCountRef.current = 0;
            return;
        }

        let isCancelled = false;
        const fetchAudioUrl = async (retryAttempt = 0, useProxy = false) => {
            setIsFetchingUrl(true);
            setAudioError(null);
            try {
                const retryParam = retryAttempt > 0 ? `&retry=${retryAttempt}` : '';
                const res = await fetch(`/api/youtube-audio?url=${encodeURIComponent(trackUrl)}${retryParam}`);
                
                const data = await res.json();
                
                if (!res.ok) {
                    if (data.canRetry && retryAttempt < 3) {
                        console.warn(`Audio URL resolution failed (attempt ${retryAttempt + 1}), retrying...`);
                        if (!isCancelled) {
                            setTimeout(() => {
                                if (!isCancelled) {
                                    fetchAudioUrl(retryAttempt + 1, useProxy);
                                }
                            }, 2000);
                        }
                        return;
                    }
                    throw new Error(data.error || `Failed to get audio URL: HTTP ${res.status}`);
                }
                
                if (!data.url && !data.directUrl) {
                    throw new Error("No audio URL returned from backend");
                }
                
                if (!isCancelled) {
                    const urlToUse = useProxy && data.proxiedUrl ? data.proxiedUrl : (data.directUrl || data.url);
                    console.log(`[MusicStreamer] Using ${useProxy ? 'proxied' : 'direct'} audio URL`);
                    setAudioStreamUrl(urlToUse);
                    setAudioError(null);
                    setCorsBlocked(false);
                    retryCountRef.current = 0;
                }
            } catch (error: any) {
                console.error("[MusicStreamer] Error fetching audio URL:", error);
                if (!isCancelled) {
                    setAudioStreamUrl(null);
                    setAudioError(error.message || "Failed to load audio");
                }
            } finally {
                if (!isCancelled) {
                    setIsFetchingUrl(false);
                }
            }
        };

        fetchAudioUrl(retryCountRef.current, corsBlocked);

        return () => {
            isCancelled = true;
        };
    }, [trackUrl, isDJ, corsBlocked]);

    useEffect(() => {
        const audioEl = audioRef.current;
        
        if (!isDJ || !room || !audioEl || isFetchingUrl || audioError) {
            if (publicationRef.current && room?.localParticipant) {
                room.localParticipant.unpublishTrack(publicationRef.current.track!).catch(e => console.warn('[MusicStreamer] Unpublish error:', e));
                publicationRef.current = null;
            }
            if (audioEl) {
                audioEl.pause();
                audioEl.src = '';
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
                audioContextRef.current = null;
                sourceNodeRef.current = null;
                destinationRef.current = null;
                gainNodeRef.current = null;
            }
            return;
        }

        const manageTrack = async () => {
            if (isPlaying && audioStreamUrl) {
                try {
                    // Check if already playing the same track
                    if (publicationRef.current && audioEl.src === audioStreamUrl && !audioEl.paused) {
                        console.log('[MusicStreamer] Already playing this track');
                        return;
                    }

                    // Unpublish existing track
                    if (publicationRef.current) {
                        console.log('[MusicStreamer] Unpublishing previous track');
                        await room.localParticipant.unpublishTrack(publicationRef.current.track!);
                        publicationRef.current = null;
                    }

                    // Set up audio element
                    console.log('[MusicStreamer] Setting up audio element');
                    audioEl.src = audioStreamUrl;
                    audioEl.crossOrigin = 'anonymous';
                    audioEl.volume = 1.0; // Full volume for local playback
                    audioEl.onerror = (e) => {
                        console.error('[MusicStreamer] Audio element error:', audioEl.error);
                        if (audioEl.error?.code === 4) setCorsBlocked(true);
                        else setAudioError(`Failed to load audio`);
                    };
                    
                    // Play audio
                    await audioEl.play().catch(e => {
                        console.error('[MusicStreamer] Play error:', e);
                        if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') setCorsBlocked(true);
                        else setAudioError("Failed to start playback");
                        throw e;
                    });
                    
                    console.log('[MusicStreamer] Audio playing, setting up Web Audio API');
                    
                    // Create audio context if needed
                    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                        console.log('[MusicStreamer] Created new AudioContext, state:', audioContextRef.current.state);
                    }
                    
                    const ctx = audioContextRef.current;
                    
                    // Resume audio context if suspended
                    if (ctx.state === 'suspended') {
                        await ctx.resume();
                        console.log('[MusicStreamer] Resumed AudioContext, new state:', ctx.state);
                    }
                    
                    // Create source node if needed
                    if (!sourceNodeRef.current) {
                        try {
                            sourceNodeRef.current = ctx.createMediaElementSource(audioEl);
                            console.log('[MusicStreamer] Created MediaElementAudioSourceNode');
                        } catch (e) {
                            console.error('[MusicStreamer] Failed to create source node:', e);
                            throw e;
                        }
                    }
                    
                    // Create gain node
                    if (!gainNodeRef.current) {
                        gainNodeRef.current = ctx.createGain();
                        gainNodeRef.current.gain.value = 1.0;
                        console.log('[MusicStreamer] Created GainNode');
                    }
                    
                    // Create destination node if needed
                    if (!destinationRef.current) {
                        destinationRef.current = ctx.createMediaStreamDestination();
                        console.log('[MusicStreamer] Created MediaStreamAudioDestinationNode');
                    }
                    
                    // Connect nodes: source -> gain -> destination + speakers
                    sourceNodeRef.current.connect(gainNodeRef.current);
                    gainNodeRef.current.connect(destinationRef.current);
                    gainNodeRef.current.connect(ctx.destination);
                    console.log('[MusicStreamer] Connected audio graph');
                    
                    // Get audio track from destination
                    const mediaStream = destinationRef.current.stream;
                    const audioTracks = mediaStream.getAudioTracks();
                    console.log('[MusicStreamer] MediaStream audio tracks:', audioTracks.length);
                    
                    if (audioTracks.length === 0) {
                        throw new Error('No audio track available from MediaStream');
                    }
                    
                    const audioTrack = audioTracks[0];
                    console.log('[MusicStreamer] Track details:', {
                        id: audioTrack.id,
                        enabled: audioTrack.enabled,
                        muted: audioTrack.muted,
                        readyState: audioTrack.readyState
                    });
                    
                    console.log('[MusicStreamer] Publishing audio track to LiveKit');
                    const publication = await room.localParticipant.publishTrack(audioTrack, { 
                        name: 'music',
                        source: LivekitClient.Track.Source.Microphone,
                        audioBitrate: 128000,
                    });
                    publicationRef.current = publication;
                    console.log('[MusicStreamer] Music track published, sid:', publication.trackSid);
                } catch (e) {
                    console.error("[MusicStreamer] Failed to publish music:", e);
                    setAudioError("Failed to publish audio");
                }
            } else {
                // Pause playback
                console.log('[MusicStreamer] Pausing playback');
                audioEl.pause();
                if (publicationRef.current) {
                    await room.localParticipant.unpublishTrack(publicationRef.current.track!).catch(e => console.warn('[MusicStreamer] Unpublish error:', e));
                    publicationRef.current = null;
                }
            }
        };
        
        manageTrack();

        return () => {
            if (room?.localParticipant && publicationRef.current) {
                room.localParticipant.unpublishTrack(publicationRef.current.track!).catch(e => console.warn('[MusicStreamer] Cleanup unpublish error:', e));
                publicationRef.current = null;
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
                audioContextRef.current = null;
                sourceNodeRef.current = null;
                destinationRef.current = null;
                gainNodeRef.current = null;
            }
        };
    }, [isDJ, isPlaying, audioStreamUrl, room, isFetchingUrl, audioError]);

    return null;
}


function RoomContent({ room, roomId }: { room: RoomData; roomId: string }) {
    const { user, isUserLoading, firestore } = useFirebase();
    const { toast } = useToast();
    const { openPopout } = usePopout();
    const [chatOpen, setChatOpen] = useState(false);
    const [voiceToken, setVoiceToken] = useState<string | undefined>(undefined);
    const [activePanels, setActivePanels] = useState({ playlist: true, add: true });
    
    const [musicVolume, setMusicVolume] = useState(0.5);
    const [localVolume, setLocalVolume] = useState(0.5);

    const roomRef = useMemoFirebase(() => doc(firestore, 'rooms', roomId), [firestore, roomId]);
    const userInRoomRef = useMemoFirebase(() => user ? doc(firestore, 'rooms', roomId, 'users', user.uid) : null, [firestore, roomId, user]);

    const isDJ = !!user && !!room.djId && user.uid === room.djId;
    const isOwner = !!user && !!room.ownerId && user.uid === room.ownerId;

    const handleClaimDJ = useCallback(() => {
        if (!roomRef || !user) {
            toast({ variant: 'destructive', title: 'Authentication Error', description: 'You must be signed in to become the DJ.' });
            return;
        }
        updateDocumentNonBlocking(roomRef, {
            djId: user.uid,
            djDisplayName: user.displayName || 'Anonymous DJ'
        });
    }, [roomRef, user, toast]);

    const handleRelinquishDJ = useCallback(() => {
        if (!roomRef || !isDJ) return;
        updateDocumentNonBlocking(roomRef, {
            djId: '',
            djDisplayName: '',
            isPlaying: false,
        });
    }, [roomRef, isDJ]);
    
    useEffect(() => {
        if (isUserLoading || !user || !roomId || voiceToken || !userInRoomRef) return;
        let isCancelled = false;
        let tokenTimeout: NodeJS.Timeout;
        
        const setupUserAndToken = async () => {
            setDocumentNonBlocking(userInRoomRef, {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`,
            }, { merge: true });

            try {
                console.log('[RoomContent] Starting token generation...');
                
                // Add timeout for token generation
                const tokenPromise = generateLiveKitToken(roomId, user.uid, user.displayName!, JSON.stringify({ photoURL: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100` }));
                
                tokenTimeout = setTimeout(() => {
                    if (!isCancelled && !voiceToken) {
                        console.error('[RoomContent] Token generation timeout after 10 seconds');
                        toast({ 
                            variant: 'destructive', 
                            title: 'Connection Timeout', 
                            description: 'LiveKit token generation timed out. Check server logs and environment variables.' 
                        });
                    }
                }, 10000);

                const token = await tokenPromise;
                clearTimeout(tokenTimeout);
                
                if (!isCancelled) {
                    console.log('[RoomContent] Token received successfully');
                    setVoiceToken(token);
                }
            } catch (e) {
                clearTimeout(tokenTimeout);
                if (!isCancelled) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    console.error("[RoomContent] Failed to generate voice token:", errorMessage);
                    toast({ 
                        variant: 'destructive', 
                        title: 'Connection Failed', 
                        description: `Could not get voice connection: ${errorMessage}` 
                    });
                }
            }
        };
        setupUserAndToken();

        return () => {
            isCancelled = true;
            clearTimeout(tokenTimeout);
            // Don't delete document - keep Discord/Twitch settings
            if (roomRef && isDJ) {
                updateDocumentNonBlocking(roomRef, { isPlaying: false });
            }
        };
    }, [user, isUserLoading, roomId, voiceToken, userInRoomRef, toast, isDJ, roomRef]);

    const currentTrack = room.playlist?.find((t: any) => t.id === room.currentTrackId);

    const handlePlayNext = useCallback(() => {
        if (!roomRef || !isDJ) return;
        const { playlist, currentTrackId } = room;
        if (!playlist || playlist.length === 0) return;
        const currentIndex = playlist.findIndex((t: any) => t.id === currentTrackId);
        const nextIndex = (currentIndex + 1) % playlist.length;
        updateDocumentNonBlocking(roomRef, { currentTrackId: playlist[nextIndex].id, isPlaying: true });
    }, [room, roomRef, isDJ]);

    const handlePlayPrev = useCallback(() => {
        if (!roomRef || !isDJ) return;
        const { playlist, currentTrackId } = room;
        if (!playlist || playlist.length === 0) return;
        const currentIndex = playlist.findIndex((t: any) => t.id === currentTrackId);
        const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
        updateDocumentNonBlocking(roomRef, { currentTrackId: playlist[prevIndex].id, isPlaying: true });
    }, [room, roomRef, isDJ]);

    const handlePlaySong = useCallback((songId: string) => {
        if (roomRef && isDJ) updateDocumentNonBlocking(roomRef, { currentTrackId: songId, isPlaying: true });
    }, [roomRef, isDJ]);
    
    const handleRemoveSong = useCallback((songId: string) => {
        if (!roomRef || !isDJ) return;
        const newPlaylist = room.playlist.filter((s: any) => s.id !== songId);
        updateDocumentNonBlocking(roomRef, { playlist: newPlaylist });
    }, [room, roomRef, isDJ]);
    
    const handleClearPlaylist = useCallback(() => {
        if (roomRef && isDJ) updateDocumentNonBlocking(roomRef, { playlist: [], currentTrackId: '', isPlaying: false });
    }, [roomRef, isDJ]);

    const handleAddItems = useCallback((items: PlaylistItem[]) => {
        if (!roomRef || !isDJ) return;
        const currentPlaylist = room.playlist || [];
        const newPlaylist = [...currentPlaylist, ...items];
        const updates: any = { playlist: newPlaylist };
        if ((!room.isPlaying || !room.currentTrackId) && items.length > 0) {
            updates.currentTrackId = items[0].id;
            updates.isPlaying = true;
        }
        updateDocumentNonBlocking(roomRef, updates);
    }, [room, roomRef, isDJ]);

    const handlePlayPause = useCallback((playing: boolean) => {
        if (roomRef && isDJ) updateDocumentNonBlocking(roomRef, { isPlaying: playing });
    }, [roomRef, isDJ]);

    const handlePostToDiscord = useCallback(async () => {
        if (!user || !firestore) {
            toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in.' });
            return;
        }
        
        console.log('[handlePostToDiscord] Starting...');
        
        try {
            const userInRoomRef = doc(firestore, 'rooms', roomId, 'users', user.uid);
            console.log('[handlePostToDiscord] Fetching user data...');
            const userDoc = await getDoc(userInRoomRef);
            const userData = userDoc.data();
            
            console.log('[handlePostToDiscord] User data:', userData);
            
            if (!userData?.discordGuildId) {
                toast({ variant: 'destructive', title: 'Discord Not Configured', description: 'Set your Discord server ID in your user card menu first.' });
                return;
            }
            
            const channelId = userData.discordSelectedChannel;
            console.log('[handlePostToDiscord] Channel ID:', channelId);
            
            if (!channelId) {
                toast({ variant: 'destructive', title: 'No Channel Selected', description: 'Select a channel in the chat widget first.' });
                return;
            }
            
            console.log('[handlePostToDiscord] Calling postToDiscord with channel:', channelId);
            await postToDiscord(channelId);
            
            console.log('[handlePostToDiscord] Success!');
            toast({
                title: "Posted to Discord!",
                description: `Control embed sent to selected channel`,
            });
        } catch (error: any) {
            console.error('[handlePostToDiscord] Error:', error);
            toast({
                variant: "destructive",
                title: "Discord Error",
                description: error.message || "Could not post to Discord.",
            });
        }
    }, [user, firestore, roomId, toast]);

    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!livekitUrl || !voiceToken) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                <h3 className="text-2xl font-bold font-headline mb-4">Connecting to Voice...</h3>
                <p className="text-muted-foreground mb-8 max-w-sm">Getting things ready. If this takes too long, please refresh.</p>
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }
    
    return (
      <LiveKitRoom
          serverUrl={livekitUrl}
          token={voiceToken}
          connect={true}
          audio={true} 
          video={false}
          options={{
            autoSubscribe: true,
            dynacast: true,
            adaptiveStream: true,
          }}
          onError={(err) => {
              console.error("LiveKit connection error:", err);
              toast({ variant: 'destructive', title: 'Connection Error', description: err.message });
          }}
      >
        <div className={cn(
            "bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right]",
            chatOpen && "md:mr-[28rem]"
          )}>
              <SidebarInset>
                  <div className="flex flex-col h-screen relative">
                        <RoomHeader
                            roomName={room.name}
                            onToggleChat={() => setChatOpen(!chatOpen)}
                            isDJ={isDJ}
                            onClaimDJ={handleClaimDJ}
                            onRelinquishDJ={handleRelinquishDJ}
                            isOwner={isOwner}
                            onOpenChatWidget={() => openPopout('chat', { width: 450, height: 600 })}
                        />
                        <main className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
                            {isDJ ? (
                                <>
                                    <div className="flex flex-col lg:flex-row gap-6">
                                        <div className="lg:w-1/3 shrink-0">
                                            <MusicPlayerCard
                                                currentTrack={currentTrack}
                                                playing={!!room.isPlaying}
                                                isPlayerControlAllowed={true}
                                                onPlayPause={handlePlayPause}
                                                onPlayNext={handlePlayNext}
                                                onPlayPrev={handlePlayPrev}
                                                onTogglePanel={(panel) => setActivePanels(p => ({ ...p, [panel]: !p[panel] }))}
                                                activePanels={activePanels}
                                                volume={localVolume}
                                                onVolumeChange={setLocalVolume}
                                            />
                                        </div>
                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                            {activePanels.playlist && (
                                                <div className={cn({ 'md:col-span-2': !activePanels.add })}>
                                                    <PlaylistPanel
                                                        playlist={room.playlist || []}
                                                        currentTrackId={room.currentTrackId || ''}
                                                        isPlayerControlAllowed={true}
                                                        onPlaySong={handlePlaySong}
                                                        onRemoveSong={handleRemoveSong}
                                                        onClearPlaylist={handleClearPlaylist}
                                                    />
                                                </div>
                                            )}
                                            {activePanels.add && (
                                                <div className={cn('flex flex-col gap-6', { 'md:col-span-2': !activePanels.playlist })}>
                                                    <AddMusicPanel
                                                        onAddItems={handleAddItems}
                                                        onClose={() => {}}
                                                        canAddMusic={true}
                                                    />
                                                    <MusicStreamerCard
                                                        trackUrl={currentTrack?.url}
                                                        isPlaying={!!room.isPlaying}
                                                        volume={musicVolume}
                                                        onVolumeChange={setMusicVolume}
                                                        onTrackEnd={handlePlayNext}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                             ) : (
                                room.djDisplayName && (
                                    <div className="text-center text-muted-foreground py-16">
                                        <h3 className="text-xl font-semibold">{room.djDisplayName} is the DJ</h3>
                                        <p className="mt-2">Sit back and enjoy the music!</p>
                                    </div>
                                )
                             )}

                            <UserList 
                                roomId={roomId}
                            />
                            
                            {(isDJ || isOwner) && (
                                <VoiceQueue roomId={roomId} />
                            )}
                        </main>
                  </div>
              </SidebarInset>
          </div>

          <div className={cn(
              "fixed inset-y-0 right-0 z-40 w-full sm:max-w-md transform transition-transform duration-300 ease-in-out bg-card border-l",
              chatOpen ? "translate-x-0" : "translate-x-full"
          )}>
              <div className="relative h-full">
                  <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} className="absolute top-4 right-4 z-50 md:hidden">
                      <X className="h-5 w-5" />
                      <span className="sr-only">Close Chat</span>
                  </Button>
                  <ChatBox />
              </div>
          </div>
        </LiveKitRoom>
    );
}

function RoomPageContent() {
    const params = useParams<{ roomId: string }>();
    const { firestore, user, isUserLoading } = useFirebase();

    const roomRef = useMemoFirebase(() => {
        if (!firestore || !params.roomId) return null;
        return doc(firestore, 'rooms', params.roomId);
    }, [firestore, params.roomId]);

    const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<RoomData>(roomRef);

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
    
    if (roomError || !room) {
        return (
            <div className="flex flex-col h-screen">
                <LeftSidebar roomId={params.roomId} />
                <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right] flex-1 flex flex-col items-center justify-center gap-4 text-center">
                    <h2 className="text-2xl font-bold">Room not found</h2>
                    <p className="text-muted-foreground">{roomError?.message || "This room may have been deleted or you may not have permission to view it."}</p>
                    <Button asChild>
                        <a href="/">Go to Dashboard</a>
                    </Button>
                </div>
            </div>
        )
    }

    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    return (
        <>
            <LeftSidebar roomId={params.roomId} />
            <RoomContent room={room} roomId={params.roomId} />
        </>
    );
}

export default function RoomPage() {
    return (
        <SidebarProvider>
            <RoomPageContent />
        </SidebarProvider>
    );
}
