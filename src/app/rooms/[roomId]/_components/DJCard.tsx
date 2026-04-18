'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Power, PowerOff } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpeakingIndicator } from './SpeakingIndicator';
import { cn } from '@/lib/utils';
import { dbUpdate } from '@/lib/db-helpers';
import { useToast } from '@/hooks/use-toast';
import type { PlaylistItem } from '@/types/playlist';

interface DJCardProps {
  roomId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  musicStatus: string | null;
  localVolume: number;
  onVolumeChange: (v: number) => void;
  canControl: boolean;
}

export default function DJCard({
  roomId, playlist, currentTrackId, isPlaying, djActive,
  musicStatus, localVolume, onVolumeChange, canControl,
}: DJCardProps) {
  const { toast } = useToast();
  const [djPopupOpen, setDjPopupOpen] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const currentTrack = playlist?.find(t => t.id === currentTrackId);
  const isStreaming = musicStatus === '🎵 streaming';

  // Check if popup is still open
  useEffect(() => {
    if (!djPopupOpen) return;
    const check = setInterval(() => {
      if (popupRef.current?.closed) {
        setDjPopupOpen(false);
        popupRef.current = null;
        dbUpdate('rooms', roomId, { djActive: false });
      }
    }, 1000);
    return () => clearInterval(check);
  }, [djPopupOpen, roomId]);

  const djLinkRef = useRef<HTMLAnchorElement | null>(null);

  const handleStartDJ = useCallback(() => {
    // Programmatically click a real anchor — browsers always open these as tabs
    djLinkRef.current?.click();
    // Small delay to let the tab open before updating state
    setTimeout(() => setDjPopupOpen(true), 500);
    toast({ title: '🎵 DJ Tab Opened', description: 'Switch to the DJ tab and click Start Broadcasting.' });
  }, [toast]);

  const handleStopDJ = useCallback(() => {
    popupRef.current?.close();
    popupRef.current = null;
    setDjPopupOpen(false);
    dbUpdate('rooms', roomId, { djActive: false, isPlaying: false });
  }, [roomId]);

  const handlePlayPause = useCallback(() => {
    if (canControl) dbUpdate('rooms', roomId, { isPlaying: !isPlaying });
  }, [roomId, isPlaying, canControl]);

  const handleNext = useCallback(() => {
    if (!canControl || !playlist?.length) return;
    const i = playlist.findIndex(t => t.id === currentTrackId);
    const next = playlist[(i + 1) % playlist.length];
    if (next) dbUpdate('rooms', roomId, { currentTrackId: next.id, isPlaying: true });
  }, [roomId, playlist, currentTrackId, canControl]);

  const handlePrev = useCallback(() => {
    if (!canControl || !playlist?.length) return;
    const i = playlist.findIndex(t => t.id === currentTrackId);
    const prev = playlist[(i - 1 + playlist.length) % playlist.length];
    if (prev) dbUpdate('rooms', roomId, { currentTrackId: prev.id, isPlaying: true });
  }, [roomId, playlist, currentTrackId, canControl]);

  const isMuted = localVolume === 0;

  return (
    <Card className="flex flex-col h-full relative">
      {isStreaming && (
        <div className="absolute -inset-1.5 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-2xl blur animate-pulse" />
      )}
      <CardContent className="p-4 flex flex-col gap-4 flex-grow relative z-10">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className={cn(
              'h-16 w-16 transition-all duration-200',
              isStreaming && 'ring-4 ring-purple-400 ring-offset-2 ring-offset-background shadow-lg',
              djActive && !isStreaming && 'ring-2 ring-yellow-400/50 ring-offset-2 ring-offset-background',
            )}>
              <AvatarImage src="https://api.dicebear.com/7.x/bottts/svg?seed=hearmeout-dj&backgroundColor=7c3aed" />
              <AvatarFallback>🎵</AvatarFallback>
            </Avatar>
            {djActive && (
              <div className={cn(
                'absolute -bottom-1 -right-1 rounded-full p-1 border-2 border-card',
                isStreaming ? 'bg-green-500' : 'bg-yellow-500',
              )}>
                <Music className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg">HearMeOut DJ</p>
            {currentTrack ? (
              <p className="text-sm text-muted-foreground truncate">
                🎵 {currentTrack.title}
                {currentTrack.artist && <span className="text-xs"> — {currentTrack.artist}</span>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {djPopupOpen ? 'DJ window open — click Start Broadcasting' : 'Click Start DJ to begin'}
              </p>
            )}
            {musicStatus && musicStatus !== 'idle' && (
              <p className={cn('text-xs mt-0.5',
                musicStatus.includes('streaming') ? 'text-green-400' :
                musicStatus === 'connected' ? 'text-blue-400' :
                musicStatus === 'error' ? 'text-red-400' :
                'text-yellow-400'
              )}>{musicStatus}</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <SpeakingIndicator audioLevel={isStreaming ? 0.6 : 0} />

          <div className="flex items-center justify-center gap-1">
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrev} disabled={!canControl || !playlist?.length}>
                <SkipBack className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent><p>Previous</p></TooltipContent></Tooltip>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10" onClick={handlePlayPause} disabled={!canControl}>
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
            </TooltipTrigger><TooltipContent><p>{isPlaying ? 'Pause' : 'Play'}</p></TooltipContent></Tooltip>

            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNext} disabled={!canControl || !playlist?.length}>
                <SkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger><TooltipContent><p>Next</p></TooltipContent></Tooltip>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onVolumeChange(isMuted ? 0.5 : 0)}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger><TooltipContent><p>{isMuted ? 'Unmute' : 'Mute'}</p></TooltipContent></Tooltip>
            <Slider value={[localVolume]} onValueChange={v => onVolumeChange(v[0])} max={1} step={0.05} />
          </div>

          <Tooltip><TooltipTrigger asChild>
            <Button
              variant={djPopupOpen ? 'destructive' : 'default'}
              size="sm"
              className="w-full gap-2"
              onClick={djPopupOpen ? handleStopDJ : handleStartDJ}
            >
              {djPopupOpen ? <><PowerOff className="h-4 w-4" /> Stop DJ</> :
                <><Power className="h-4 w-4" /> Start DJ</>}
            </Button>
          </TooltipTrigger><TooltipContent><p>{djPopupOpen ? 'Close the DJ window' : 'Open DJ tab to play music for everyone'}</p></TooltipContent></Tooltip>

          {/* Hidden anchor to force open as tab */}
          <a ref={djLinkRef} href={`/dj/${roomId}`} target="_blank" rel="noopener" className="hidden" />
        </div>
      </CardContent>
    </Card>
  );
}
