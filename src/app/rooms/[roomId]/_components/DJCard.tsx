'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Film, ListMusic, LoaderCircle, Music, Pause, Play, Power, PowerOff, Radio, SkipForward, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getRoomWatchSessionId, isActivityRoomId } from '@/lib/watch-session';
import { SpeakingIndicator } from './SpeakingIndicator';
import { cn } from '@/lib/utils';
import type { PlaylistItem } from '@/types/playlist';

type SharedMusicState = {
  queue: Array<{ requestId: string; item: { title: string } }>;
  current: {
    requestId: string;
    item: {
      title: string;
      runtime?: string;
      metadata?: { artist?: string };
    };
  } | null;
  autoRadio?: boolean;
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
    muted?: boolean;
    volume?: number;
  };
};

interface DJCardProps {
  roomId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  djStatus?: string;
  musicStatus: string | null;
  localVolume: number;
  // eslint-disable-next-line no-unused-vars
  onVolumeChange: (v: number) => void;
  canControl: boolean;
  autoRadio?: boolean;
  djIsLive: boolean;
  djStarting?: boolean;
  onStartDJ: () => void;
  onStopDJ: () => void;
  onStartAudio: () => void;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
}

function effectivePlaybackPosition(playback?: SharedMusicState['playback'], now = Date.now()) {
  if (!playback) return 0;
  if (playback.status !== 'playing') return Math.max(0, Number(playback.position || 0));
  return Math.max(0, Number(playback.position || 0) + (now - Number(playback.updatedAt || now)) / 1000);
}

function runtimeSeconds(value?: string) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'unknown' || raw === 'live') return 0;
  if (raw.includes(':')) {
    const parts = raw.split(':').map(Number);
    if (parts.every(Number.isFinite)) return parts.reduce((total, part) => total * 60 + part, 0);
  }
  let total = 0;
  for (const match of raw.matchAll(/(\d+)\s*(h|m|s)/gi)) {
    const amount = Number(match[1]);
    total += match[2].toLowerCase() === 'h' ? amount * 3600 : match[2].toLowerCase() === 'm' ? amount * 60 : amount;
  }
  return total;
}

function formatClock(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export default function DJCard({
  roomId, playlist, currentTrackId, isPlaying: legacyIsPlaying, djActive,
  djStatus, musicStatus, localVolume, onVolumeChange, canControl,
  autoRadio: legacyAutoRadio,
  djIsLive, djStarting, onStartDJ, onStopDJ,
  onStartAudio, onOpenQueue, onOpenAddSong, onOpenWatch,
}: DJCardProps) {
  const musicSessionId = getRoomWatchSessionId(roomId, 'music');
  const activityRoom = isActivityRoomId(roomId);
  const legacyCurrentTrack = playlist?.find((track) => track.id === currentTrackId);
  const [sharedState, setSharedState] = useState<SharedMusicState | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState(false);
  const [activePanel, setActivePanel] = useState<'controls' | 'radio' | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/watch/sessions/${encodeURIComponent(musicSessionId)}/state`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        setSharedState(await response.json());
      } catch {
        // The visible status retains the last known state during a transient poll failure.
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [musicSessionId]);

  useEffect(() => {
    if (sharedState?.playback.status !== 'playing') return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sharedState?.playback.status]);

  useEffect(() => {
    const playback = sharedState?.playback;
    if (!playback) return;
    setVolumeDraft(null);
    const sharedVolume = Math.max(0, Math.min(100, Number(playback.volume ?? 85))) / 100;
    onVolumeChange(playback.muted ? 0 : sharedVolume);
  }, [onVolumeChange, sharedState?.playback.muted, sharedState?.playback.volume]);

  useEffect(() => {
    setSeekDraft(null);
  }, [sharedState?.current?.requestId, sharedState?.playback.position, sharedState?.playback.updatedAt]);

  const sendSharedControl = useCallback(async (action: string, value?: number) => {
    if (!canControl) return null;
    setControlPending(true);
    setControlError(null);
    try {
      const query = new URLSearchParams({
        action,
        format: 'json',
        platform: 'web',
        roomId,
        isHost: 'true',
      });
      if (Number.isFinite(value)) query.set('position', String(value));
      if (action === 'next' && sharedState?.current?.requestId) {
        query.set('expectedRequestId', sharedState.current.requestId);
      }
      const response = await fetch(`/api/watch/sessions/${encodeURIComponent(musicSessionId)}/quick-control?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Shared music control failed');
      setSharedState(payload.session);
      return payload.session as SharedMusicState;
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Shared music control failed');
      return null;
    } finally {
      setControlPending(false);
    }
  }, [canControl, musicSessionId, roomId, sharedState?.current?.requestId]);

  const sharedItem = sharedState?.current?.item;
  const currentTitle = sharedItem?.title || (activityRoom ? undefined : legacyCurrentTrack?.title);
  const currentArtist = sharedItem?.metadata?.artist || (activityRoom ? undefined : legacyCurrentTrack?.artist);
  const sharedIsPlaying = sharedState
    ? sharedState.playback.status === 'playing'
    : activityRoom ? false : Boolean(legacyIsPlaying);
  const isStreaming = sharedIsPlaying || (!activityRoom && musicStatus === '🎵 streaming');
  const displayDjActive = activityRoom ? Boolean(sharedState?.current) : djActive;
  const duration = runtimeSeconds(sharedItem?.runtime)
    || (activityRoom ? 0 : Math.max(0, Math.round(Number(legacyCurrentTrack?.duration || 0) / 1000)));
  const livePosition = Math.min(duration || Number.POSITIVE_INFINITY, effectivePlaybackPosition(sharedState?.playback, clockNow));
  const displayedPosition = seekDraft ?? livePosition;
  const sharedVolume = volumeDraft ?? Math.max(0, Math.min(100, Number(sharedState?.playback.volume ?? Math.round(localVolume * 100))));
  const sharedMuted = sharedState?.playback.muted ?? sharedVolume === 0;
  const sharedAutoRadio = sharedState?.autoRadio ?? (activityRoom ? false : Boolean(legacyAutoRadio));
  const visibleStatus = controlError
    || (sharedState?.current ? `${sharedState.playback.status} · shared with Discord` : null)
    || (activityRoom ? null : djStatus)
    || (activityRoom ? null : musicStatus);

  const handlePlayPause = useCallback(() => {
    if (!activityRoom) onStartAudio();
    void sendSharedControl(sharedIsPlaying ? 'pause' : 'play', effectivePlaybackPosition(sharedState?.playback));
  }, [activityRoom, onStartAudio, sendSharedControl, sharedIsPlaying, sharedState?.playback]);

  const handleNext = useCallback(() => {
    void sendSharedControl('next', 0);
  }, [sendSharedControl]);

  const handleMute = useCallback(() => {
    onVolumeChange(sharedMuted ? Math.max(0.01, sharedVolume / 100) : 0);
    void sendSharedControl(sharedMuted ? 'unmute' : 'mute', effectivePlaybackPosition(sharedState?.playback));
  }, [onVolumeChange, sendSharedControl, sharedMuted, sharedState?.playback, sharedVolume]);

  return (
    <Card className="relative flex h-full flex-col">
      {isStreaming ? <div className="absolute -inset-1.5 animate-pulse rounded-2xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 blur" /> : null}
      <CardContent className="relative z-10 flex flex-grow flex-col gap-4 p-4">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className={cn(
              'h-16 w-16 transition-all duration-200',
              isStreaming && 'ring-4 ring-purple-400 ring-offset-2 ring-offset-background shadow-lg',
              displayDjActive && !isStreaming && 'ring-2 ring-yellow-400/50 ring-offset-2 ring-offset-background',
            )}>
              <AvatarImage src="https://api.dicebear.com/7.x/bottts/svg?seed=hearmeout-dj&backgroundColor=7c3aed" />
              <AvatarFallback>🎵</AvatarFallback>
            </Avatar>
            {displayDjActive ? (
              <div className={cn('absolute -bottom-1 -right-1 rounded-full border-2 border-card p-1', isStreaming ? 'bg-green-500' : 'bg-yellow-500')}>
                <Music className="h-3 w-3 text-white" />
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">HearMeOut DJ</p>
            {currentTitle ? (
              <p className="truncate text-sm text-muted-foreground">
                🎵 {currentTitle}{currentArtist ? <span className="text-xs"> — {currentArtist}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Shared Discord music queue is waiting for a song</p>
            )}
            {visibleStatus && visibleStatus !== 'idle' ? (
              <p className={cn(
                'mt-0.5 text-xs',
                controlError ? 'text-red-400' :
                  visibleStatus.includes('playing') || visibleStatus.includes('Streaming') || visibleStatus.includes('streaming') ? 'text-green-400' :
                  visibleStatus.includes('shared') || visibleStatus === 'connected' ? 'text-blue-400' :
                  visibleStatus.includes('failed') || visibleStatus.includes('Failed') ? 'text-red-400' : 'text-yellow-400',
              )}>{visibleStatus}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto space-y-3">
          <SpeakingIndicator audioLevel={isStreaming ? 0.6 : 0} />

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="w-10 text-right tabular-nums">{formatClock(displayedPosition)}</span>
              <Slider
                aria-label="Shared music position"
                value={[duration ? Math.min(duration, displayedPosition) : 0]}
                onValueChange={(value) => setSeekDraft(value[0])}
                onValueCommit={(value) => void sendSharedControl('seek', value[0])}
                max={Math.max(1, duration)}
                step={1}
                disabled={!canControl || !sharedState?.current || duration <= 0 || controlPending}
              />
              <span className="w-10 tabular-nums">{duration ? formatClock(duration) : '--:--'}</span>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={handlePlayPause} disabled={!canControl || !sharedState?.current || controlPending}>
                  {sharedIsPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
              </TooltipTrigger><TooltipContent><p>{sharedIsPlaying ? 'Pause everywhere' : 'Play everywhere'}</p></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleNext} disabled={!canControl || !sharedState?.current || controlPending}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>Next everywhere</p></TooltipContent></Tooltip>
            </div>

            <div className="flex items-center gap-2">
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleMute} disabled={!canControl || controlPending}>
                  {sharedMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
              </TooltipTrigger><TooltipContent><p>{sharedMuted ? 'Unmute everywhere' : 'Mute everywhere'}</p></TooltipContent></Tooltip>
              <Slider
                aria-label="Shared music volume"
                value={[sharedMuted ? 0 : sharedVolume]}
                onValueChange={(value) => {
                  setVolumeDraft(value[0]);
                  onVolumeChange(value[0] / 100);
                }}
                onValueCommit={(value) => void sendSharedControl('volume', value[0])}
                max={100}
                step={1}
                disabled={!canControl || controlPending}
              />
              <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{sharedMuted ? 0 : Math.round(sharedVolume)}%</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!activityRoom ? (
              <Tooltip><TooltipTrigger asChild>
                <Button variant={activePanel === 'controls' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setActivePanel(activePanel === 'controls' ? null : 'controls')}>
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>DJ connection controls</p></TooltipContent></Tooltip>
            ) : null}
            <Tooltip><TooltipTrigger asChild>
              <Button variant={sharedAutoRadio ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setActivePanel(activePanel === 'radio' ? null : 'radio')}>
                <Radio className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent><p>Auto-radio</p></TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenQueue}>
                <ListMusic className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent><p>Open shared queue</p></TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenAddSong}>
                <Music className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent><p>Add songs</p></TooltipContent></Tooltip>
            {onOpenWatch ? (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenWatch}>
                  <Film className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>Open music player</p></TooltipContent></Tooltip>
            ) : null}
            {!activityRoom ? (
              <Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onStartAudio}>
                  <Play className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>Enable local audio</p></TooltipContent></Tooltip>
            ) : null}
          </div>

          {activePanel === 'controls' && !activityRoom ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-center gap-2">
                <Button variant={djIsLive ? 'secondary' : 'outline'} size="sm" className="h-9 gap-1 px-2" onClick={onStartDJ} disabled={djStarting}>
                  {djStarting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} On
                </Button>
                <Button variant="outline" size="sm" className="h-9 gap-1 px-2" onClick={onStopDJ} disabled={djStarting}>
                  <PowerOff className="h-4 w-4" /> Off
                </Button>
              </div>
            </div>
          ) : null}

          {activePanel === 'radio' && canControl ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <Button
                variant={sharedAutoRadio ? 'secondary' : 'outline'}
                size="sm"
                className="w-full gap-2"
                onClick={() => void sendSharedControl('auto-radio', sharedAutoRadio ? 0 : 1)}
                disabled={controlPending}
              >
                <Radio className="h-4 w-4" /> {sharedAutoRadio ? 'Auto-Radio ON' : 'Auto-Radio OFF'}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
