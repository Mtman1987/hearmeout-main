'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LiveKitRoom, RoomContext, useConnectionState } from '@livekit/components-react';
import { ConnectionState, DisconnectReason, Room as LKRoom } from 'livekit-client';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from "@/components/ui/button";
import { Copy, X, LoaderCircle, FrameIcon, Music, Monitor, Film, ExternalLink, Radio } from 'lucide-react';
import LeftSidebar from '@/app/components/LeftSidebar';
import UserList from './_components/UserList';
import ChatBox from './_components/ChatBox';
import VoiceQueue from './_components/VoiceQueue';
import { VoiceBridgeCard } from './_components/VoiceBridgeCard';
import { cn } from "@/lib/utils";
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbUpdate, dbSet } from '@/lib/db-helpers';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { dbGet } from '@/lib/db-helpers';
import { generateLiveKitToken } from '@/app/actions';
import { PlaylistItem } from "@/types/playlist";
import { getScreenPeerId, PeerScreenViewer, PeerVoiceMesh } from '@/lib/peer-audio-service';
import { ACTIVITY_ROOM_ID, ACTIVITY_ROOM_NAME, getRoomWatchSessionId, isActivityRoomId, type WatchMediaKind } from '@/lib/watch-session';
import { canManageRoom } from '@/lib/room-access';
import { effectiveRoomExpiry, ROOM_LIFETIME_HOURS } from '@/lib/room-lifecycle';

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
  djPeerId?: string | null;
  peerFallback?: boolean;
  isPrivate?: boolean;
  password?: string;
  createdAt?: string;
  expiresAt?: string;
}

type WatchCardState = {
  roomUrl?: string;
  current: {
    requestId: string;
    addedAt?: string;
    item: { title: string; year?: number; source?: string };
    requestedBy?: { username?: string };
  } | null;
  playback?: { status?: string };
};

function watchUrlForRoom(url: string, canPause: boolean) {
    try {
        const next = new URL(url, window.location.origin);
        next.searchParams.set('canPause', canPause ? '1' : '0');
        return next.pathname + next.search;
    } catch {
        return `${url}${url.includes('?') ? '&' : '?'}canPause=${canPause ? '1' : '0'}`;
    }
}

function SharedWatchCard({ roomId, onOpenWatch, sessionScope = 'discord', canPause = false }: { roomId: string; onOpenWatch: () => void; sessionScope?: 'discord' | 'overlay'; canPause?: boolean }) {
    const [state, setState] = useState<WatchCardState | null>(null);
    const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(null);
    const sessionId = getRoomWatchSessionId(roomId, 'movie');

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            try {
                const res = await fetch(`/api/watch/sessions/${sessionId}/state`, { cache: 'no-store' });
                if (!res.ok || cancelled) return;
                setState(await res.json());
            } catch {}
        };
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [sessionId]);

    if (!state?.current || state.current.requestId === dismissedRequestId) return null;

    const watchRoomUrl = watchUrlForRoom(state.roomUrl || `/watch/${sessionId}`, canPause);
    const overlayUrl = `/overlay/${encodeURIComponent(roomId)}?media=auto`;
    const closeWatchCard = () => setDismissedRequestId(state.current?.requestId || null);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg font-headline">
                    <Film className="h-5 w-5" /> Room Watch Party
                </CardTitle>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onOpenWatch}>Controls</Button>
                    <Button variant="outline" size="sm" asChild>
                        <a href={sessionScope === 'overlay' ? overlayUrl : watchRoomUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> {sessionScope === 'overlay' ? 'Overlay' : 'Open'}
                        </a>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={closeWatchCard} aria-label="Close Watch Party card">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {sessionScope === 'overlay' ? (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-black/80 p-4 text-center text-sm text-muted-foreground">
                        <Music className="h-6 w-6 text-emerald-300" />
                        <p>Stream Mode is on. Media is playing through the OBS overlay URL, while room voices stay here.</p>
                        <Button variant="outline" size="sm" asChild>
                            <a href={overlayUrl} target="_blank" rel="noreferrer">Open Overlay</a>
                        </Button>
                    </div>
                ) : (
                    <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
                        <iframe
                            src={watchRoomUrl}
                            className="h-full w-full"
                            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        />
                    </div>
                )}
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                        {state.current.item.title}{state.current.item.year ? ` (${state.current.item.year})` : ''}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                        {state.current.item.source || 'watch'} · {state.playback?.status || 'idle'}
                        {state.current.requestedBy?.username ? ` · by ${state.current.requestedBy.username}` : ''}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}

const ACTIVITY_WATCH_LANES: Array<{ kind: WatchMediaKind; label: string; sessionId: string }> = [
    { kind: 'movie', label: 'Movies', sessionId: getRoomWatchSessionId(ACTIVITY_ROOM_ID, 'movie') },
    { kind: 'music', label: 'Music', sessionId: getRoomWatchSessionId(ACTIVITY_ROOM_ID, 'music') },
];

function DiscordActivityEmbedCard({ canPause = false }: { canPause?: boolean }) {
    const [states, setStates] = useState<Record<string, WatchCardState | null>>({});
    const [selectedKind, setSelectedKind] = useState<WatchMediaKind>('movie');

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            const entries = await Promise.all(ACTIVITY_WATCH_LANES.map(async (lane) => {
                try {
                    const res = await fetch(`/api/watch/sessions/${lane.sessionId}/state`, { cache: 'no-store' });
                    return [lane.sessionId, res.ok ? await res.json() : null] as const;
                } catch {
                    return [lane.sessionId, null] as const;
                }
            }));
            if (!cancelled) setStates(Object.fromEntries(entries));
        };

        fetch('/api/activity-room/ensure', { method: 'POST' }).catch(() => {});
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        const selectedLane = ACTIVITY_WATCH_LANES.find((lane) => lane.kind === selectedKind) || ACTIVITY_WATCH_LANES[0];
        if (states[selectedLane.sessionId]?.current) return;

        const activeLane = ACTIVITY_WATCH_LANES.find((lane) => states[lane.sessionId]?.current);
        if (activeLane && activeLane.kind !== selectedKind) setSelectedKind(activeLane.kind);
    }, [selectedKind, states]);

    const selectedLane = ACTIVITY_WATCH_LANES.find((lane) => lane.kind === selectedKind) || ACTIVITY_WATCH_LANES[0];
    const selectedState = states[selectedLane.sessionId] || null;
    const selectedUrl = watchUrlForRoom(selectedState?.roomUrl || `/watch/${selectedLane.sessionId}`, canPause);

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
                <CardTitle className="flex items-center gap-2 text-lg font-headline">
                    <Film className="h-5 w-5" /> {ACTIVITY_ROOM_NAME}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                    {ACTIVITY_WATCH_LANES.map((lane) => {
                        const laneState = states[lane.sessionId];
                        const active = selectedKind === lane.kind;
                        const Icon = lane.kind === 'music' ? Music : Film;
                        return (
                            <Button
                                key={lane.kind}
                                variant={active ? 'secondary' : 'outline'}
                                size="sm"
                                onClick={() => setSelectedKind(lane.kind)}
                            >
                                <Icon className="mr-1 h-3.5 w-3.5" />
                                {lane.label}
                                {laneState?.current ? <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
                            </Button>
                        );
                    })}
                    <Button variant="outline" size="sm" asChild>
                        <a href={selectedUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                        </a>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
                    {selectedState?.current ? (
                        <iframe
                            src={selectedUrl}
                            title={`${selectedLane.label} Discord Activity playback`}
                            className="h-full w-full"
                            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                            <Monitor className="h-7 w-7 text-muted-foreground/70" />
                            <p>No {selectedLane.label.toLowerCase()} Activity media is loaded yet.</p>
                        </div>
                    )}
                </div>
                {selectedState?.current ? (
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                            {selectedState.current.item.title}{selectedState.current.item.year ? ` (${selectedState.current.item.year})` : ''}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                            {selectedState.current.item.source || selectedLane.label} · {selectedState.playback?.status || 'idle'}
                            {selectedState.current.requestedBy?.username ? ` · by ${selectedState.current.requestedBy.username}` : ''}
                        </p>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}

function screenShareLabel(peerId: string) {
    const cleaned = peerId.replace(/^hmo-screen-/, '');
    const separator = cleaned.lastIndexOf('-');
    return separator > -1 ? cleaned.slice(separator + 1) : cleaned;
}

function SharedScreenShareCard({ roomId }: { roomId: string }) {
    const { user } = useSession();
    const [availableShares, setAvailableShares] = useState<string[]>([]);
    const [viewing, setViewing] = useState<string | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
    const viewerRef = useRef<PeerScreenViewer | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const ownPeerId = user ? getScreenPeerId(roomId, user.uid) : null;

    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await fetch(`/api/peer-voice/peers?roomId=${encodeURIComponent(`screen-${roomId}`)}`, { cache: 'no-store' });
                if (!res.ok || cancelled) return;
                const { peers } = await res.json();
                setAvailableShares(Array.isArray(peers) ? peers : []);
            } catch {}
        };
        poll();
        const interval = setInterval(poll, 3000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [roomId]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream, viewing]);

    useEffect(() => {
        return () => viewerRef.current?.disconnect();
    }, []);

    const stopViewing = useCallback(() => {
        viewerRef.current?.disconnect();
        viewerRef.current = null;
        setViewing(null);
        setRemoteStream(null);
        if (videoRef.current) videoRef.current.srcObject = null;
    }, []);

    const viewShare = useCallback(async (peerId: string) => {
        stopViewing();
        const viewer = new PeerScreenViewer();
        viewerRef.current = viewer;
        try {
            await viewer.connect(
                peerId,
                (stream) => setRemoteStream(stream),
                () => {
                    setViewing(null);
                    setRemoteStream(null);
                },
            );
            setViewing(peerId);
        } catch {
            stopViewing();
        }
    }, [stopViewing]);

    useEffect(() => {
        if (!ownPeerId || viewing || remoteStream || !availableShares.includes(ownPeerId)) return;
        void viewShare(ownPeerId);
    }, [availableShares, ownPeerId, remoteStream, viewShare, viewing]);

    if (availableShares.length === 0) return null;
    const shareSignature = availableShares.slice().sort().join('|');
    if (shareSignature === dismissedSignature) return null;
    const stopOwnShare = async () => {
        if (!ownPeerId) return;
        window.dispatchEvent(new CustomEvent('hmo-stop-screen-share', { detail: { roomId } }));
        await fetch('/api/peer-voice/register', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: `screen-${roomId}`, peerId: ownPeerId }),
        }).catch(() => undefined);
        stopViewing();
        setAvailableShares((current) => current.filter((peerId) => peerId !== ownPeerId));
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg font-headline">
                    <Monitor className="h-5 w-5" /> Screen Share
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setDismissedSignature(shareSignature)} aria-label="Close Screen Share card">
                    <X className="h-4 w-4" />
                </Button>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
                    {viewing ? (
                        <video ref={videoRef} className="h-full w-full object-contain" autoPlay playsInline />
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            Choose an active share to view.
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {ownPeerId && availableShares.includes(ownPeerId) && (
                        <Button variant="destructive" size="sm" onClick={stopOwnShare}>
                            Stop Sharing
                        </Button>
                    )}
                    {availableShares.map((peerId) => (
                        <Button
                            key={peerId}
                            variant={viewing === peerId ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => ownPeerId === peerId ? stopOwnShare() : viewing === peerId ? stopViewing() : viewShare(peerId)}
                        >
                            {ownPeerId === peerId
                                ? 'Stop Sharing'
                                : viewing === peerId
                                  ? 'Stop Viewing'
                                  : `View ${screenShareLabel(peerId)}`}
                        </Button>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function RoomHeader({ roomName, onToggleChat, showDJ, onToggleDJ, canBridge, showVoiceBridge, onToggleVoiceBridge, peerFallback, livekitReady, onScreenShare }: {
    roomName: string; onToggleChat: () => void; showDJ: boolean; onToggleDJ: () => void; canBridge?: boolean; showVoiceBridge?: boolean; onToggleVoiceBridge?: () => void; peerFallback?: boolean; livekitReady?: boolean; onScreenShare?: () => void;
}) {
    const { isMobile } = useSidebar();
    const params = useParams();
    const { toast } = useToast();

    const copyOverlayUrl = async () => {
        const copied = await copyTextToClipboard(`${window.location.origin}/overlay/${params.roomId}`);
        if (copied) {
            toast({ title: "Overlay URL Copied!", description: "Paste this into OBS as a browser source." });
        } else {
            toast({ variant: 'destructive', title: "Copy Failed", description: "Clipboard permission was denied. Select and copy the URL from the address bar instead." });
        }
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
                    <Button
                        variant={showDJ ? "secondary" : "outline"}
                        size="icon"
                        onClick={onToggleDJ}
                        aria-label={showDJ ? 'Hide HearMeOut DJ controls' : 'Show HearMeOut DJ controls'}
                    >
                        <Music className="h-4 w-4" />
                    </Button>
                </TooltipTrigger><TooltipContent><p>{showDJ ? 'Hide HearMeOut DJ controls' : 'Show HearMeOut DJ controls'}</p></TooltipContent></Tooltip>
                {canBridge && onToggleVoiceBridge && (
                    <Tooltip><TooltipTrigger asChild>
                        <Button
                            variant={showVoiceBridge ? "secondary" : "outline"}
                            size="icon"
                            onClick={onToggleVoiceBridge}
                            aria-label={showVoiceBridge ? 'Hide Discord voice bridge' : 'Show Discord voice bridge'}
                        >
                            <Radio className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger><TooltipContent><p>{showVoiceBridge ? 'Hide Discord voice bridge' : 'Show Discord voice bridge'}</p></TooltipContent></Tooltip>
                )}
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

async function copyTextToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {}

    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        return copied;
    } catch {
        return false;
    }
}

function liveKitErrorPayload(err: unknown, area: string, roomId: string, identity?: string | null) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
        area,
        message: error.message,
        name: error.name,
        stack: error.stack,
        code: (err as any)?.code || null,
        status: (err as any)?.status || null,
        roomId,
        identity: identity || null,
        userAgent: navigator.userAgent,
    };
}

function voiceDisconnectMessage(reason?: DisconnectReason) {
    switch (reason) {
        case DisconnectReason.DUPLICATE_IDENTITY:
            return 'Voice moved to your newer HearMeOut session. This page is still open, but it no longer owns your microphone.';
        case DisconnectReason.PARTICIPANT_REMOVED:
            return 'Voice was disconnected by a room moderator.';
        case DisconnectReason.ROOM_DELETED:
        case DisconnectReason.ROOM_CLOSED:
            return 'The LiveKit voice room has ended.';
        case DisconnectReason.JOIN_FAILURE:
            return 'Voice could not finish connecting.';
        case DisconnectReason.CONNECTION_TIMEOUT:
        case DisconnectReason.MEDIA_FAILURE:
            return 'Voice lost its media connection and could not recover automatically.';
        default:
            return 'Voice disconnected and could not recover automatically.';
    }
}

function RoomContent({ room, roomId }: { room: RoomData; roomId: string }) {
    const { user, isLoading: isUserLoading } = useSession();
    const userId = user?.uid;
    const userDisplayName = user?.displayName || (user as any)?.username || 'User';
    const userPhotoURL = user?.photoURL || (userId ? `https://picsum.photos/seed/${userId}/100/100` : '');
    const { toast } = useToast();
    const { openPopout } = usePopout();
    const router = useRouter();
    const [chatOpen, setChatOpen] = useState(false);
    const [voiceToken, setVoiceToken] = useState<string | undefined>(undefined);
    const [voiceFallbackActive, setVoiceFallbackActive] = useState(false);
    const [voiceFallbackFailed, setVoiceFallbackFailed] = useState(false);
    const [voiceFailureMessage, setVoiceFailureMessage] = useState<string | null>(null);
    const [voiceConnectionGeneration, setVoiceConnectionGeneration] = useState(0);
    const [voiceRetrying, setVoiceRetrying] = useState(false);
    const [peerMicEnabled, setPeerMicEnabled] = useState(false);
    const peerVoiceRef = useRef<PeerVoiceMesh | null>(null);
    const peerVoiceStartingRef = useRef(false);
    const [peerVoiceStreams, setPeerVoiceStreams] = useState<Map<string, MediaStream>>(new Map());
    const peerVoiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
    const [peerAudioBlocked, setPeerAudioBlocked] = useState(false);
    const [localVolume, setLocalVolume] = useState(0.5);
    const [showDJ, setShowDJ] = useState(false);
    const [showVoiceBridge, setShowVoiceBridge] = useState(false);
    const isActivityRoom = isActivityRoomId(roomId);

    const { data: userSettings } = useDoc<{ streamMode?: boolean; twitchChannel?: string }>(
      user ? `rooms/${roomId}/users` : null,
      user?.uid || null,
    );

    const isOwner = canManageRoom(user as any, room.ownerId);
    const fallbackRoomRef = useRef<LKRoom | null>(null);
    const voiceIdentityRef = useRef<string>('');
    const voiceTokenRef = useRef<string | undefined>(undefined);
    const voiceFallbackActiveRef = useRef(false);
    useEffect(() => { voiceTokenRef.current = voiceToken; }, [voiceToken]);
    useEffect(() => { voiceFallbackActiveRef.current = voiceFallbackActive; }, [voiceFallbackActive]);

    const isStreamMode = !!userSettings?.streamMode;

    const mintVoiceToken = useCallback(async () => {
        if (!userId) throw new Error('Sign in is required for voice.');
        voiceIdentityRef.current = userId;
        return generateLiveKitToken(
            roomId,
            voiceIdentityRef.current,
            userDisplayName,
            JSON.stringify({ uid: userId, displayName: userDisplayName, photoURL: userPhotoURL }),
        );
    }, [roomId, userDisplayName, userId, userPhotoURL]);

    const startPeerVoiceFallback = useCallback(async (reason: unknown) => {
        if (!userId || !roomId || peerVoiceRef.current?.active || peerVoiceStartingRef.current) return;
        peerVoiceStartingRef.current = true;
        voiceFallbackActiveRef.current = true;
        voiceTokenRef.current = undefined;
        setVoiceToken(undefined);
        setVoiceFallbackActive(true);
        setVoiceFallbackFailed(false);
        setVoiceFailureMessage(reason instanceof Error ? reason.message : String(reason || 'LiveKit unavailable'));
        console.warn('[Voice] LiveKit unavailable, trying PeerJS voice fallback:', reason);
        try {
            const mesh = new PeerVoiceMesh();
            await mesh.join(
                roomId,
                userId,
                (peerId, stream) => {
                    setPeerVoiceStreams(prev => new Map(prev).set(peerId, stream));
                    let audioEl = peerVoiceAudioRefs.current.get(peerId);
                    if (!audioEl) {
                        audioEl = new Audio();
                        audioEl.autoplay = true;
                        audioEl.setAttribute('playsinline', '');
                        audioEl.muted = false;
                        audioEl.volume = 1;
                        audioEl.style.display = 'none';
                        document.body.appendChild(audioEl);
                        peerVoiceAudioRefs.current.set(peerId, audioEl);
                    }
                    audioEl.srcObject = stream;
                    audioEl.play().then(() => {
                        setPeerAudioBlocked(false);
                    }).catch((playbackError) => {
                        setPeerAudioBlocked(true);
                        fetch('/api/client-log', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                area: 'peer-voice-playback',
                                message: playbackError instanceof Error ? playbackError.message : String(playbackError),
                                roomId,
                                identity: peerId,
                                userAgent: navigator.userAgent,
                            }),
                        }).catch(() => {});
                    });
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
                        audioEl.remove();
                        peerVoiceAudioRefs.current.delete(peerId);
                    }
                },
                true,
            );
            peerVoiceRef.current = mesh;
            mesh.setMuted(true);
            setPeerMicEnabled(false);
            toast({ title: 'Voice Connected (P2P)', description: 'Using peer-to-peer voice in listen-only mode. Use Unmute when you want to talk.' });
        } catch (peerErr) {
            setVoiceFallbackFailed(true);
            console.error('[Voice] PeerJS fallback failed:', peerErr);
            toast({ variant: 'destructive', title: 'Voice Failed', description: `Could not connect voice: ${peerErr instanceof Error ? peerErr.message : String(peerErr)}` });
        } finally {
            peerVoiceStartingRef.current = false;
        }
    }, [roomId, toast, userId]);

    const retryLiveKitVoice = useCallback(async () => {
        if (!userId || voiceRetrying) return;
        setVoiceRetrying(true);
        try {
            peerVoiceRef.current?.leave();
            peerVoiceRef.current = null;
            for (const audioEl of peerVoiceAudioRefs.current.values()) {
                audioEl.srcObject = null;
                audioEl.remove();
            }
            peerVoiceAudioRefs.current.clear();
            setPeerVoiceStreams(new Map());
            setPeerMicEnabled(false);
            fallbackRoomRef.current = null;
            voiceFallbackActiveRef.current = false;
            setVoiceFallbackActive(false);
            setVoiceFallbackFailed(false);

            const token = await mintVoiceToken();
            voiceTokenRef.current = token;
            setVoiceToken(token);
            setVoiceConnectionGeneration((value) => value + 1);
            setVoiceFailureMessage(null);
        } catch (error) {
            setVoiceFailureMessage(error instanceof Error ? error.message : 'Voice reconnect failed.');
            setVoiceFallbackFailed(true);
        } finally {
            setVoiceRetrying(false);
        }
    }, [mintVoiceToken, userId, voiceRetrying]);

    const unlockPeerAudio = useCallback(async () => {
        const results = await Promise.allSettled(
            Array.from(peerVoiceAudioRefs.current.values()).map((audioEl) => audioEl.play()),
        );
        const blocked = results.some((result) => result.status === 'rejected');
        setPeerAudioBlocked(blocked);
        toast(blocked
            ? { variant: 'destructive', title: 'P2P Audio Still Blocked', description: 'Check this site\'s sound output and browser autoplay permissions.' }
            : { title: 'P2P Audio Enabled', description: 'Incoming room voice is now playing.' });
    }, [toast]);

    // Voice transport must be room-wide. If one browser cannot reach LiveKit
    // and registers on the PeerJS mesh, move the remaining browsers to that
    // same mesh so the room is not split across two isolated voice networks.
    useEffect(() => {
        if (!userId || !roomId || !voiceToken || voiceFallbackActive) return;
        let cancelled = false;

        const followRoomFallback = async () => {
            try {
                const res = await fetch(`/api/peer-voice/peers?roomId=${encodeURIComponent(roomId)}`, {
                    cache: 'no-store',
                });
                if (!res.ok || cancelled) return;
                const payload = await res.json() as { peers?: string[] };
                if (Array.isArray(payload.peers) && payload.peers.length > 0) {
                    await startPeerVoiceFallback(new Error('Another participant switched this room to P2P voice'));
                }
            } catch {
                // LiveKit remains active when fallback discovery is unavailable.
            }
        };

        void followRoomFallback();
        const interval = setInterval(followRoomFallback, 3000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [roomId, startPeerVoiceFallback, userId, voiceFallbackActive, voiceToken]);

    // Check if user is banned
    const [isBanned, setIsBanned] = React.useState(false);
    useEffect(() => {
      if (!userId || !roomId) return;
      dbGet(`rooms/${roomId}/banned`, userId).then(data => { if (data) setIsBanned(true); });
    }, [userId, roomId]);

    // Poll for move instructions
    useEffect(() => {
      if (!userId || !roomId) return;
      const checkMove = async () => {
        const move = await dbGet(`rooms/${roomId}/moves`, userId);
        if (move?.targetRoomId) {
          fetch('/api/db', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: `rooms/${roomId}/moves`, id: userId }) }).catch(() => {});
          toast({ title: 'Moved!', description: `You've been moved to ${move.targetRoomName || 'another room'}.` });
          router.push(`/rooms/${move.targetRoomId}`);
        }
      };
      const interval = setInterval(checkMove, 3000);
      return () => clearInterval(interval);
    }, [userId, roomId, router, toast]);

    useEffect(() => {
        if (isUserLoading || !userId || !roomId) return;
        if (voiceTokenRef.current || voiceFallbackActiveRef.current) return;
        let isCancelled = false;
        const setup = async () => {
            const userPresence = {
                uid: userId,
                displayName: userDisplayName,
                photoURL: userPhotoURL,
                lastSeen: Date.now(),
            };
            dbSet(`rooms/${roomId}/users`, userId, userPresence, true);
            // Update occupant count
            fetch(`/api/db?collection=rooms/${roomId}/users`).then(r => r.json()).then(users => {
                if (Array.isArray(users)) dbUpdate('rooms', roomId, { occupantCount: users.length });
            }).catch(() => {});
            try {
                const token = await mintVoiceToken();
                if (!isCancelled) setVoiceToken(token);
            } catch (e) {
                if (isCancelled) return;
                await startPeerVoiceFallback(e);
            }
        };
        setup();
        const heartbeat = setInterval(() => {
            dbSet(`rooms/${roomId}/users`, userId, { lastSeen: Date.now() }, true);
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
                body: JSON.stringify({ collection: `rooms/${roomId}/users`, id: userId }),
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
              audioEl.remove();
            }
            peerVoiceAudioRefs.current.clear();
        };
    }, [isUserLoading, roomId, mintVoiceToken, startPeerVoiceFallback, userDisplayName, userId, userPhotoURL]);

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
    const expiresAt = effectiveRoomExpiry(room.expiresAt, room.createdAt);
    const isExpired = expiresAt ? Date.now() > expiresAt : false;
    if (isExpired) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <h3 className="text-2xl font-bold font-headline mb-4">Room Expired</h3>
          <p className="text-muted-foreground mb-8">This room has reached its {ROOM_LIFETIME_HOURS}-hour shelf life. Create a new one!</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      );
    }

    const voiceReady = !!livekitUrl && !!voiceToken;
    const fallbackRoom = voiceFallbackActive ? getFallbackRoom() : null;

    return (
      voiceReady ? (
      <LiveKitRoom key={voiceConnectionGeneration} serverUrl={livekitUrl} token={voiceToken} connect={true} audio={false} video={false}
          options={{ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }}
          onConnected={() => setVoiceFailureMessage(null)}
          onDisconnected={(reason) => {
            if (reason === DisconnectReason.CLIENT_INITIATED || voiceFallbackActiveRef.current) return;
            setVoiceFailureMessage(voiceDisconnectMessage(reason));
          }}
          onError={(err) => {
            if (voiceFallbackActiveRef.current || peerVoiceStartingRef.current) return;
            fetch('/api/client-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(liveKitErrorPayload(err, 'livekit-room', roomId, voiceIdentityRef.current || null)),
            }).catch(() => {});
            void startPeerVoiceFallback(err);
          }}>
        {renderRoomUI()}
      </LiveKitRoom>
      ) : fallbackRoom ? (
        <RoomContext.Provider value={fallbackRoom}>
          {renderRoomUI()}
        </RoomContext.Provider>
      ) : renderRoomUI()
    );

    function getFallbackRoom() {
      if (!fallbackRoomRef.current) {
        fallbackRoomRef.current = new LKRoom();
      }
      const fallbackRoom = fallbackRoomRef.current;
      const localParticipant = fallbackRoom.localParticipant as any;
      const displayName = user?.displayName || (user as any)?.username || 'User';
      const photoURL = user?.photoURL || `https://picsum.photos/seed/${user?.uid || 'user'}/100/100`;

      localParticipant.sid = `p2p-${user?.uid || 'local'}`;
      localParticipant.identity = voiceIdentityRef.current || user?.uid || 'local';
      localParticipant.name = displayName;
      localParticipant.metadata = JSON.stringify({ uid: user?.uid, displayName, photoURL });
      Object.defineProperty(localParticipant, 'isMicrophoneEnabled', {
        configurable: true,
        get: () => peerMicEnabled,
      });
      localParticipant.setMicrophoneEnabled = async (enabled: boolean) => {
        peerVoiceRef.current?.setMuted(!enabled);
        setPeerMicEnabled(enabled);
        return undefined;
      };

      return fallbackRoom;
    }

    function renderRoomUI() {
      return (
        <>
        <div className={cn("bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right]", chatOpen && "md:mr-[28rem]")}>
            <SidebarInset>
                <div className="flex flex-col h-screen relative">
                    <RoomHeader
                      roomName={room.name}
                      onToggleChat={() => setChatOpen(!chatOpen)}
                      showDJ={showDJ}
                      onToggleDJ={() => setShowDJ(v => !v)}
                      canBridge={isOwner || isActivityRoom}
                      showVoiceBridge={showVoiceBridge}
                      onToggleVoiceBridge={() => setShowVoiceBridge(v => !v)}
                      peerFallback={voiceFallbackActive}
                      livekitReady={voiceReady}
                      onScreenShare={() => openPopout('screenShare', { width: 720, height: 520 }, { source: 'screenShare' })}
                    />

                    <main className="flex-1 p-4 md:p-6 overflow-y-auto space-y-6">
                        {(voiceFailureMessage || voiceFallbackActive || voiceFallbackFailed) && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                            <div>
                              <p className="text-sm font-medium">
                                {voiceFallbackActive ? 'Using P2P voice fallback' : 'LiveKit voice needs attention'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {voiceFallbackActive
                                  ? 'You are still listening. Your microphone starts muted; use the existing Unmute button when you want to talk.'
                                  : voiceFailureMessage || 'Voice is currently disconnected.'}
                              </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => void retryLiveKitVoice()} disabled={voiceRetrying}>
                              {voiceRetrying ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Reconnect LiveKit
                            </Button>
                          </div>
                        )}
                        <UserList
                          roomId={roomId}
                          localVolume={localVolume}
                          onVolumeChange={setLocalVolume}
                          showDJ={showDJ}
                          onOpenQueue={() => openPopout('watch', { width: 760, height: 700 }, { source: 'musicQueue', sessionScope: isStreamMode ? 'overlay' : 'discord', roomId, canControl: isOwner || isActivityRoom, initialTab: 'music' })}
                          onOpenAddSong={() => openPopout('addSong', { width: 460, height: 560 }, { source: 'addSong', sessionScope: isStreamMode ? 'overlay' : 'discord', roomId, canControl: isOwner })}
                          onOpenWatch={() => openPopout('watch', { width: 760, height: 700 }, { source: 'musicWatch', sessionScope: isStreamMode ? 'overlay' : 'discord', roomId, canControl: isOwner || isActivityRoom, initialTab: 'music' })}
                          voiceEnabled={voiceReady || voiceFallbackActive}
                          voicePeerFallback={voiceFallbackActive}
                          peerConnectedPeerIds={Array.from(peerVoiceStreams.keys())}
                          peerAudioBlocked={peerAudioBlocked}
                          onEnablePeerAudio={unlockPeerAudio}
                        />
                        {isActivityRoomId(roomId) ? (
                          <DiscordActivityEmbedCard canPause={isOwner} />
                        ) : (
                          <SharedWatchCard
                            roomId={roomId}
                            sessionScope={isStreamMode ? 'overlay' : 'discord'}
                            canPause={isOwner}
                            onOpenWatch={() => openPopout('watch', { width: 760, height: 700 }, { source: 'watch', sessionScope: isStreamMode ? 'overlay' : 'discord', roomId, canControl: isOwner })}
                          />
                        )}
                        <SharedScreenShareCard roomId={roomId} />
                        {(isOwner || isActivityRoomId(roomId)) && showVoiceBridge && <VoiceBridgeCard roomId={roomId} />}
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
    const { user } = useSession();
    const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<RoomData>('rooms', params.roomId, 2000);
    const [passwordInput, setPasswordInput] = React.useState('');
    const [passwordUnlocked, setPasswordUnlocked] = React.useState(false);
    const [passwordError, setPasswordError] = React.useState(false);
    const isActivityRoom = isActivityRoomId(params.roomId);

    React.useEffect(() => {
        if (isActivityRoom) fetch('/api/activity-room/ensure', { method: 'POST' }).catch(() => {});
    }, [isActivityRoom]);

    const effectiveRoom: RoomData | null = isActivityRoom ? {
        id: ACTIVITY_ROOM_ID,
        name: ACTIVITY_ROOM_NAME,
        ownerId: room?.ownerId || ACTIVITY_ROOM_ID,
        playlist: room?.playlist || [],
        currentTrackId: room?.currentTrackId,
        isPlaying: room?.isPlaying || false,
        djActive: room?.djActive || false,
        djStatus: room?.djStatus || 'Discord Activity watch room',
        autoRadio: room?.autoRadio || false,
        playHistory: room?.playHistory || [],
        isPrivate: false,
    } : room;

    if (!isActivityRoom && isRoomLoading) {
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

    if (!effectiveRoom || (!isActivityRoom && roomError)) {
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
    const isOwner = canManageRoom(user as any, effectiveRoom.ownerId);
    if (effectiveRoom.isPrivate && effectiveRoom.password && !passwordUnlocked && !isOwner) {
        return (
            <div className="flex flex-col h-screen">
                <LeftSidebar roomId={params.roomId} />
                <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left,margin-right] flex-1 flex flex-col items-center justify-center gap-4 text-center p-4">
                    <h2 className="text-2xl font-bold">🔒 {effectiveRoom.name}</h2>
                    <p className="text-muted-foreground">This room requires a password to join.</p>
                    <div className="flex gap-2 w-full max-w-xs">
                        <input
                            type="password"
                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Enter password"
                            value={passwordInput}
                            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { if (passwordInput === effectiveRoom.password) setPasswordUnlocked(true); else setPasswordError(true); } }}
                        />
                        <Button onClick={() => { if (passwordInput === effectiveRoom.password) setPasswordUnlocked(true); else setPasswordError(true); }}>Join</Button>
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
            <RoomContent room={effectiveRoom} roomId={params.roomId} />
        </>
    );
}

export default function RoomPage() {
    return <SidebarProvider><RoomPageContent /></SidebarProvider>;
}
