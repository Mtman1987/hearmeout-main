'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LiveKitRoom, useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from "@/components/ui/button";
import { Copy, X, LoaderCircle, FrameIcon, Music, Monitor } from 'lucide-react';
import LeftSidebar from '@/app/components/LeftSidebar';
import UserList from './_components/UserList';
import ChatBox from './_components/ChatBox';
import VoiceQueue from './_components/VoiceQueue';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbUpdate, dbSet } from '@/lib/db-helpers';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { dbGet } from '@/lib/db-helpers';
import { Room as LKRoom, RoomEvent, Track, RemoteTrack } from 'livekit-client';
import { generateLiveKitToken, generateMusicRoomToken } from '@/app/actions';
import { PlaylistItem } from "@/types/playlist";
import { PeerAudioListener, PeerVoiceMesh } from '@/lib/peer-audio-service';

interface RoomData {
  id: string;
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  djStatus?: string;
  autoRadio?: boolean;
  playHistory?: string[];
  isPrivate?: boolean;
  password?: string;
  expiresAt?: string;
}

function RoomHeader({ roomName, onToggleChat, showDJ, onToggleDJ, peerFallback, livekitReady, onScreenShare }: {
    roomName: string; onToggleChat: () => void; showDJ: boolean; onToggleDJ: () => void; peerFallback?: boolean; livekitReady?: boolean; onScreenShare?: () => void;
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
                <ConnectionStatusIndicator peerFallback={peerFallback} livekitReady={livekitReady} />
            </div>
            <div className="flex flex-initial items-center justify-end space-x-2">
                <Tooltip><TooltipTrigger asChild>
                    <Button variant={showDJ ? "secondary" : "outline"} size="icon" onClick={onToggleDJ}><Music className="h-4 w-4" /></Button>
                </TooltipTrigger><TooltipContent><p>{showDJ ? 'Hide DJ' : 'Show DJ'}</p></TooltipContent></Tooltip>
                {onScreenShare && (
                    <Tooltip><TooltipTrigger asChild>
                        <Button variant="outline" size="icon" onClick={onScreenShare}><Monitor className="h-4 w-4" /></Button>
                    </TooltipTrigger><TooltipContent><p>Screen Share</p></TooltipContent></Tooltip>
                )}
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

function LiveKitConnectionStatus() {
    const connectionState = useConnectionState();
    let indicatorClass = 'bg-gray-500';
    let statusText = 'Unknown';

    switch (connectionState) {
        case ConnectionState.Connected: indicatorClass = 'bg-green-500'; statusText = 'Connected'; break;
        case ConnectionState.Connecting: indicatorClass = 'bg-yellow-500 animate-pulse'; statusText = 'Connecting'; break;
        case ConnectionState.Disconnected: indicatorClass = 'bg-red-500'; statusText = 'Disconnected'; break;
        case ConnectionState.Reconnecting: indicatorClass = 'bg-yellow-500 animate-pulse'; statusText = 'Reconnecting'; break;
    }

    return <StatusDot indicatorClass={indicatorClass} statusText={statusText} />;
}

function StatusDot({ indicatorClass, statusText }: { indicatorClass: string; statusText: string }) {
    return (
        <Tooltip><TooltipTrigger><div className={cn("h-2.5 w-2.5 rounded-full", indicatorClass)} /></TooltipTrigger>
        <TooltipContent><p>Voice: {statusText}</p></TooltipContent></Tooltip>
    );
}

function ConnectionStatusIndicator({ peerFallback, livekitReady }: { peerFallback?: boolean; livekitReady?: boolean }) {
    if (peerFallback) {
        return <StatusDot indicatorClass="bg-blue-500" statusText="P2P Voice" />;
    }
    if (livekitReady) return <LiveKitConnectionStatus />;
    return <StatusDot indicatorClass="bg-gray-500" statusText="No voice" />;
}

function getOrCreateSessionId(key: string) {
    try {
        const existing = sessionStorage.getItem(key);
        if (existing) return existing;
        const generated = Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(key, generated);
        return generated;
    } catch {
        return Math.random().toString(36).slice(2, 8);
    }
}

function RoomContent({ room, roomId }: { room: RoomData; roomId: string }) {
    const { user, isLoading: isUserLoading } = useSession();
    const { toast } = useToast();
    const { openPopout } = usePopout();
    const router = useRouter();
    const [chatOpen, setChatOpen] = useState(false);
    const [voiceToken, setVoiceToken] = useState<string | undefined>(undefined);
    const [voiceFallbackActive, setVoiceFallbackActive] = useState(false);
    const peerVoiceRef = useRef<PeerVoiceMesh | null>(null);
    const [peerVoiceStreams, setPeerVoiceStreams] = useState<Map<string, MediaStream>>(new Map());
    const peerVoiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
    const [localVolume, setLocalVolume] = useState(0.5);
    const [musicStatus, setMusicStatus] = useState<string | null>(null);
    const [showDJ, setShowDJ] = useState(false);

    const { data: userSettings } = useDoc<{ streamMode?: boolean; twitchChannel?: string }>(
      user ? `rooms/${roomId}/users` : null,
      user?.uid || null,
    );

    const isAdmin = !!user && !!(user as any).isAdmin;
    const isOwner = !!user && (user.uid === room.ownerId || isAdmin);
    const canControl = !!user;

    const musicRoomRef = useRef<LKRoom | null>(null);
    const musicAudioRef = useRef<HTMLAudioElement | null>(null);
    const musicIdentityRef = useRef<string>('');
    const voiceIdentityRef = useRef<string>('');
    const localVolumeRef = useRef(localVolume);
    const userGestureUnlockedRef = useRef(false);
    const peerListenerRef = useRef<PeerAudioListener | null>(null);
    useEffect(() => { localVolumeRef.current = localVolume; }, [localVolume]);

    const isStreamMode = !!userSettings?.streamMode;

    // DJ start/stop via server-side API (Puppeteer on hmo-dj-worker)
    const [djStarting, setDjStarting] = useState(false);
    const handleStartMusicAudio = useCallback(async () => {
        const lkRoom = musicRoomRef.current;
        try {
            userGestureUnlockedRef.current = true;
            await lkRoom?.startAudio();
            const audio = musicAudioRef.current;
            if (audio) {
                audio.volume = localVolumeRef.current;
                await audio.play();
            }
            setMusicStatus(prev => prev || 'connected');
            toast({ title: 'Music Audio Ready', description: 'Music playback is unlocked for this page.' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Music Audio Blocked',
                description: err instanceof Error ? err.message : 'Click again after the DJ stream connects.',
            });
        }
    }, [toast]);

    const handleStartDJ = useCallback(async () => {
        setDjStarting(true);
        try {
            const res = await fetch('/api/dj', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start', roomId }),
            });
            const data = await res.json();
            if (!data.success) {
                toast({ variant: 'destructive', title: 'DJ Error', description: data.message });
            } else {
                toast({ title: 'DJ Connected', description: data.message || 'Server DJ is starting.' });
            }
        } catch (err) {
            toast({ variant: 'destructive', title: 'DJ Error', description: 'Failed to start DJ' });
        } finally {
            setDjStarting(false);
        }
    }, [roomId, toast]);

    const handleStopDJ = useCallback(async () => {
        try {
            const res = await fetch('/api/dj', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'stop', roomId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || data?.success === false) {
                toast({ variant: 'destructive', title: 'DJ Error', description: data?.message || data?.error || 'Failed to stop DJ' });
            } else {
                toast({ title: 'DJ Disconnected', description: data?.message || 'HearMeOut DJ stopped.' });
            }
        } catch {
            toast({ variant: 'destructive', title: 'DJ Error', description: 'Failed to stop DJ' });
        }
    }, [roomId, toast]);

    // Connect to LiveKit Music Room as subscriber.
    // Stream-mode users skip this — they hear music from the OBS overlay.
    // Falls back to PeerJS if LiveKit fails (e.g. tokens exhausted).
    useEffect(() => {
        if (isUserLoading || !user || !roomId) return;
        if (isStreamMode) {
            setMusicStatus('stream mode (music in overlay)');
            return;
        }
        let cancelled = false;

        const connectMusicRoom = async () => {
            try {
                console.log('[MusicRoom] Connecting as listener...');
                if (!musicIdentityRef.current) {
                    const tabId = getOrCreateSessionId('hmo_music_tab_id');
                    musicIdentityRef.current = `${user.uid}-${tabId}`;
                }
                const token = await generateMusicRoomToken(
                    roomId,
                    musicIdentityRef.current,
                    user.displayName || 'Listener',
                    false,
                );
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
                        if (userGestureUnlockedRef.current) {
                            musicAudioRef.current.play().catch(e => console.warn('[MusicRoom] Autoplay blocked:', e));
                        }
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
                lkRoom.on(RoomEvent.Disconnected, (reason) => {
                    console.warn('[MusicRoom] Disconnected:', reason);
                });
                lkRoom.on(RoomEvent.Reconnecting, () => {
                    console.warn('[MusicRoom] Reconnecting...');
                });
                lkRoom.on(RoomEvent.Reconnected, () => {
                    console.log('[MusicRoom] Reconnected');
                });
            } catch (err) {
                console.warn('[MusicRoom] LiveKit failed, trying PeerJS fallback:', err);
                if (cancelled) return;
                // PeerJS fallback
                try {
                    const listener = new PeerAudioListener();
                    await listener.connect(
                        roomId,
                        (stream) => {
                            if (!musicAudioRef.current) musicAudioRef.current = new Audio();
                            musicAudioRef.current.srcObject = stream;
                            musicAudioRef.current.volume = localVolumeRef.current;
                            if (userGestureUnlockedRef.current) {
                                musicAudioRef.current.play().catch(() => {});
                            }
                            setMusicStatus('🎵 streaming (P2P)');
                        },
                        () => {
                            setMusicStatus('P2P disconnected');
                        },
                    );
                    if (cancelled) { listener.disconnect(); return; }
                    peerListenerRef.current = listener;
                    setMusicStatus('connected (P2P)');
                } catch (peerErr) {
                    console.error('[MusicRoom] PeerJS fallback also failed:', peerErr);
                    setMusicStatus('error');
                }
            }
        };

        connectMusicRoom();
        return () => {
            cancelled = true;
            musicRoomRef.current?.disconnect();
            musicRoomRef.current = null;
            peerListenerRef.current?.disconnect();
            peerListenerRef.current = null;
            if (musicAudioRef.current) { musicAudioRef.current.srcObject = null; }
        };
    }, [user, isUserLoading, roomId, isStreamMode]);

    // Sync volume changes to the audio element
    useEffect(() => {
        if (musicAudioRef.current) {
            musicAudioRef.current.volume = localVolume;
        }
    }, [localVolume]);

    useEffect(() => {
        const unlockMusicAudio = () => {
            userGestureUnlockedRef.current = true;
            const audio = musicAudioRef.current;
            if (!audio || !audio.srcObject) return;
            audio.volume = localVolumeRef.current;
            void audio.play().catch(() => {});
        };
        window.addEventListener('pointerdown', unlockMusicAudio, { passive: true });
        window.addEventListener('keydown', unlockMusicAudio);
        window.addEventListener('touchstart', unlockMusicAudio, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', unlockMusicAudio);
            window.removeEventListener('keydown', unlockMusicAudio);
            window.removeEventListener('touchstart', unlockMusicAudio);
        };
    }, []);

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
        if (voiceToken || voiceFallbackActive) return;
        let isCancelled = false;
        const setup = async () => {
            const userPresence = {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`,
                lastSeen: Date.now(),
            };
            dbSet(`rooms/${roomId}/users`, user.uid, userPresence, true);
            // Update occupant count
            fetch(`/api/db?collection=rooms/${roomId}/users`).then(r => r.json()).then(users => {
                if (Array.isArray(users)) dbUpdate('rooms', roomId, { occupantCount: users.length });
            }).catch(() => {});
            try {
                if (!voiceIdentityRef.current) {
                    const tabId = getOrCreateSessionId('hmo_voice_tab_id');
                    voiceIdentityRef.current = `${user.uid}-${tabId}`;
                }
                const displayName = user.displayName || (user as any).username || 'User';
                const photoURL = user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`;
                const token = await generateLiveKitToken(
                    roomId,
                    voiceIdentityRef.current,
                    displayName,
                    JSON.stringify({ uid: user.uid, displayName, photoURL }),
                );
                if (!isCancelled) setVoiceToken(token);
            } catch (e) {
                console.warn('[Voice] LiveKit token failed, trying PeerJS voice fallback:', e);
                if (isCancelled) return;
                // PeerJS voice mesh fallback
                try {
                    const mesh = new PeerVoiceMesh();
                    await mesh.join(
                        roomId,
                        user.uid,
                        (peerId, stream) => {
                            setPeerVoiceStreams(prev => new Map(prev).set(peerId, stream));
                            // Auto-play remote audio
                            let audioEl = peerVoiceAudioRefs.current.get(peerId);
                            if (!audioEl) {
                                audioEl = new Audio();
                                audioEl.autoplay = true;
                                peerVoiceAudioRefs.current.set(peerId, audioEl);
                            }
                            audioEl.srcObject = stream;
                            audioEl.play().catch(() => {});
                        },
                        (peerId) => {
                            setPeerVoiceStreams(prev => {
                                const next = new Map(prev);
                                next.delete(peerId);
                                return next;
                            });
                            const audioEl = peerVoiceAudioRefs.current.get(peerId);
                            if (audioEl) {
                                audioEl.srcObject = null;
                                peerVoiceAudioRefs.current.delete(peerId);
                            }
                        },
                    );
                    if (isCancelled) { mesh.leave(); return; }
                    peerVoiceRef.current = mesh;
                    setVoiceFallbackActive(true);
                    toast({ title: 'Voice Connected (P2P)', description: 'Using peer-to-peer voice since LiveKit is unavailable.' });
                } catch (peerErr) {
                    if (!isCancelled) toast({ variant: 'destructive', title: 'Voice Failed', description: `Could not connect voice: ${peerErr instanceof Error ? peerErr.message : String(peerErr)}` });
                }
            }
        };
        setup();
        const heartbeat = setInterval(() => {
            dbSet(`rooms/${roomId}/users`, user.uid, { lastSeen: Date.now() }, true);
            // Re-register peer presence for discovery
            if (peerVoiceRef.current?.active) {
                fetch('/api/peer-voice/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomId, peerId: peerVoiceRef.current.peerId }),
                }).catch(() => {});
            }
        }, 5000);

        const clearPresence = () => {
            fetch('/api/db', {
                method: 'DELETE',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection: `rooms/${roomId}/users`, id: user.uid }),
            }).then(() => {
                // Update occupant count on leave
                fetch(`/api/db?collection=rooms/${roomId}/users`).then(r => r.json()).then(users => {
                    if (Array.isArray(users)) {
                        fetch('/api/db', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 'rooms', id: roomId, data: { occupantCount: users.length } }) }).catch(() => {});
                    }
                }).catch(() => {});
            }).catch(() => {});
            peerVoiceRef.current?.leave();
            peerVoiceRef.current = null;
        };

        const onPageHide = () => clearPresence();
        window.addEventListener('pagehide', onPageHide);

        return () => {
            isCancelled = true;
            clearInterval(heartbeat);
            window.removeEventListener('pagehide', onPageHide);
            clearPresence();
            // Clean up audio elements
            for (const [, audioEl] of peerVoiceAudioRefs.current) {
                audioEl.srcObject = null;
            }
            peerVoiceAudioRefs.current.clear();
        };
    }, [user, isUserLoading, roomId, toast, voiceToken, voiceFallbackActive]);

    const handleToggleAutoRadio = useCallback(() => {
        dbUpdate('rooms', roomId, { autoRadio: !room.autoRadio });
    }, [roomId, room.autoRadio]);

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

    // Room expiry check
    const expiresAt = room.expiresAt ? new Date(room.expiresAt).getTime() : null;
    const isExpired = expiresAt ? Date.now() > expiresAt : false;
    const expiresInMs = expiresAt ? expiresAt - Date.now() : null;
    const expiringSoon = expiresInMs !== null && expiresInMs > 0 && expiresInMs < 30 * 60 * 1000;

    if (isExpired) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <h3 className="text-2xl font-bold font-headline mb-4">Room Expired</h3>
          <p className="text-muted-foreground mb-8">This room has reached its 12-hour shelf life. Create a new one!</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      );
    }

    const voiceReady = !!livekitUrl && !!voiceToken;

    return (
      voiceReady ? (
      <LiveKitRoom serverUrl={livekitUrl} token={voiceToken} connect={true} audio={!userSettings?.streamMode} video={false}
          options={{ dynacast: true, adaptiveStream: true }}
          onError={(err) => { toast({ variant: 'destructive', title: 'Connection Error', description: err.message }); }}>
        {renderRoomUI()}
      </LiveKitRoom>
      ) : renderRoomUI()
    );

    function renderRoomUI() {
      return (
        <>
        <div className={cn("bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right]", chatOpen && "md:mr-[28rem]")}>
            <SidebarInset>
                <div className="flex flex-col h-screen relative">
                    <RoomHeader roomName={room.name} onToggleChat={() => setChatOpen(!chatOpen)} showDJ={showDJ} onToggleDJ={() => setShowDJ(v => !v)} peerFallback={voiceFallbackActive} livekitReady={voiceReady} onScreenShare={() => openPopout('screenShare', { width: 720, height: 520 }, { source: 'screenShare' })} />

                    <main className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
                        {/* Hidden audio element for LiveKit music track attachment */}
                        <audio ref={musicAudioRef} className="sr-only" />

                        <UserList
                          roomId={roomId}
                          musicStatus={musicStatus}
                          localVolume={localVolume}
                          onVolumeChange={setLocalVolume}
                          showDJ={showDJ}
                          djStatus={room.djStatus}
                          autoRadio={room.autoRadio}
                          onToggleAutoRadio={handleToggleAutoRadio}
                          djIsLive={!!room.djActive}
                          djStarting={djStarting}
                          onStartDJ={handleStartDJ}
                          onStopDJ={handleStopDJ}
                          onStartAudio={handleStartMusicAudio}
                          onOpenQueue={() => openPopout('queue', { width: 760, height: 720 }, { source: 'queue' })}
                          onOpenAddSong={() => openPopout('addSong', { width: 460, height: 560 }, { source: 'addSong' })}
                          onOpenWatch={() => openPopout('watch', { width: 640, height: 700 }, { source: 'watch' })}
                          voiceEnabled={voiceReady}
                        />
                        {isOwner && <VoiceQueue roomId={roomId} />}
                    </main>
                </div>
            </SidebarInset>
        </div>
        <div className={cn("fixed inset-y-0 right-0 z-40 w-full sm:max-w-md transform transition-transform duration-300 ease-in-out bg-card border-l", chatOpen ? "translate-x-0" : "translate-x-full")}>
            <div className="relative h-full">
                <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} className="absolute top-4 right-4 z-50 md:hidden"><X className="h-5 w-5" /></Button>
                <ChatBox
                  onOpenSpaceChat={() => openPopout('chat', { width: 440, height: 620 }, { source: 'space' })}
                  onOpenTwitchChat={() => openPopout('chat', { width: 440, height: 620 }, { source: 'twitch' })}
                  onOpenDiscordChat={() => openPopout('chat', { width: 520, height: 680 }, { source: 'discord' })}
                />
            </div>
        </div>
        </>
      );
    }
}

function RoomPageContent() {
    const params = useParams<{ roomId: string }>();
    const { user, isLoading: isUserLoading } = useSession();
    const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<RoomData>('rooms', params.roomId, 2000);
    const [passwordInput, setPasswordInput] = React.useState('');
    const [passwordUnlocked, setPasswordUnlocked] = React.useState(false);
    const [passwordError, setPasswordError] = React.useState(false);

    if (isRoomLoading) {
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
                    <p className="text-muted-foreground">{roomError?.message || "This room may have been deleted."}</p>
                    <Button asChild><a href="/">Go to Dashboard</a></Button>
                </div>
            </div>
        );
    }

    // Password gate for private rooms
    const isOwner = !!user && (user.uid === room.ownerId || !!(user as any).isAdmin);
    if (room.isPrivate && room.password && !passwordUnlocked && !isOwner) {
        return (
            <div className="flex flex-col h-screen">
                <LeftSidebar roomId={params.roomId} />
                <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right] flex-1 flex flex-col items-center justify-center gap-4 text-center p-4">
                    <h2 className="text-2xl font-bold">🔒 {room.name}</h2>
                    <p className="text-muted-foreground">This room requires a password to join.</p>
                    <div className="flex gap-2 w-full max-w-xs">
                        <input
                            type="password"
                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Enter password"
                            value={passwordInput}
                            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { if (passwordInput === room.password) setPasswordUnlocked(true); else setPasswordError(true); } }}
                        />
                        <Button onClick={() => { if (passwordInput === room.password) setPasswordUnlocked(true); else setPasswordError(true); }}>Join</Button>
                    </div>
                    {passwordError && <p className="text-sm text-destructive">Incorrect password</p>}
                    <Button variant="ghost" asChild><a href="/">Back to Dashboard</a></Button>
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
