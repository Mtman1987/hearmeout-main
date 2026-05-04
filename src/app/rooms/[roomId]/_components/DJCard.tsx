'use client';

import React, { useCallback, useState } from 'react';
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Power, PowerOff, Radio, LoaderCircle, SlidersHorizontal, ListMusic } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpeakingIndicator } from './SpeakingIndicator';
import { cn } from '@/lib/utils';
import { dbUpdateStrict } from '@/lib/db-helpers';
import type { PlaylistItem } from '@/types/playlist';
import PlaylistPanel from './PlaylistPanel';
import AddMusicPanel from './AddMusicPanel';

interface DJCardProps {
  roomId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  djStatus?: string;
  musicStatus: string | null;
  localVolume: number;
  onVolumeChange: (v: number) => void;
  canControl: boolean;
  autoRadio?: boolean;
  onToggleAutoRadio?: () => void;
  djIsLive: boolean;
  djStarting?: boolean;
  onStartDJ: () => void;
  onStopDJ: () => void;
  onPlaySong: (songId: string) => void;
  onRemoveSong: (songId: string) => void;
  onClearPlaylist: () => void;
  onAddItems: (items: PlaylistItem[]) => void;
}

export default function DJCard({
  roomId, playlist, currentTrackId, isPlaying, djActive,
  djStatus, musicStatus, localVolume, onVolumeChange, canControl,
  autoRadio, onToggleAutoRadio,
  djIsLive, djStarting, onStartDJ, onStopDJ,
  onPlaySong, onRemoveSong, onClearPlaylist, onAddItems,
}: DJCardProps) {
  const currentTrack = playlist?.find(t => t.id === currentTrackId);
  const isStreaming = musicStatus === '🎵 streaming';
  const [controlError, setControlError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'controls' | 'radio' | 'queue' | null>(null);
  const visibleStatus = controlError || djStatus || musicStatus;

  const updatePlayback = useCallback(async (data: Record<string, unknown>) => {
    if (!canControl) return;
    setControlError(null);
    try {
      await dbUpdateStrict('rooms', roomId, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playback update failed';
      setControlError(message);
    }
  }, [canControl, roomId]);

  const handlePlayPause = useCallback(() => {
    void updatePlayback({ isPlaying: !isPlaying });
  }, [isPlaying, updatePlayback]);

  const handleNext = useCallback(() => {
    if (!canControl || !playlist?.length) return;
    const i = playlist.findIndex(t => t.id === currentTrackId);
    const next = playlist[(i + 1) % playlist.length];
    if (next) void updatePlayback({ currentTrackId: next.id, isPlaying: true });
  }, [playlist, currentTrackId, canControl, updatePlayback]);

  const handlePrev = useCallback(() => {
    if (!canControl || !playlist?.length) return;
    const i = playlist.findIndex(t => t.id === currentTrackId);
    const prev = playlist[(i - 1 + playlist.length) % playlist.length];
    if (prev) void updatePlayback({ currentTrackId: prev.id, isPlaying: true });
  }, [playlist, currentTrackId, canControl, updatePlayback]);

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
                {djIsLive ? 'DJ active — waiting for tracks' : 'Click Start DJ to begin'}
              </p>
            )}
            {visibleStatus && visibleStatus !== 'idle' && (
              <p className={cn('text-xs mt-0.5',
                controlError ? 'text-red-400' :
                visibleStatus.includes('Streaming') || visibleStatus.includes('streaming') ? 'text-green-400' :
                visibleStatus === 'connected' ? 'text-blue-400' :
                visibleStatus === 'error' || visibleStatus.includes('failed') || visibleStatus.includes('Failed') ? 'text-red-400' :
                'text-yellow-400'
              )}>{visibleStatus}</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <SpeakingIndicator audioLevel={isStreaming ? 0.6 : 0} />

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Tooltip><TooltipTrigger asChild>
                <Button variant={activePanel === 'controls' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setActivePanel(activePanel === 'controls' ? null : 'controls')}>
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>DJ controls</p></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant={autoRadio ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setActivePanel(activePanel === 'radio' ? null : 'radio')}>
                  <Radio className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>Auto-radio</p></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant={activePanel === 'queue' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setActivePanel(activePanel === 'queue' ? null : 'queue')}>
                  <ListMusic className="h-4 w-4" />
                </Button>
              </TooltipTrigger><TooltipContent><p>Queue</p></TooltipContent></Tooltip>
            </div>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onVolumeChange(isMuted ? 0.5 : 0)}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger><TooltipContent><p>{isMuted ? 'Unmute' : 'Mute'}</p></TooltipContent></Tooltip>
            <Slider value={[localVolume]} onValueChange={v => onVolumeChange(v[0])} max={1} step={0.05} />
          </div>

          {activePanel === 'controls' && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-3">
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
                <Tooltip><TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn('h-9 w-9 border-0 text-white', djIsLive ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}
                    onClick={djIsLive ? onStopDJ : onStartDJ}
                    disabled={djStarting}
                  >
                    {djStarting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : djIsLive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger><TooltipContent><p>{djIsLive ? 'Stop DJ' : 'Start DJ'}</p></TooltipContent></Tooltip>
              </div>
            </div>
          )}

          {activePanel === 'radio' && canControl && (
            <div className="rounded-md border bg-muted/20 p-3">
              <Tooltip><TooltipTrigger asChild>
                <Button variant={autoRadio ? 'secondary' : 'outline'} size="sm" className="w-full gap-2" onClick={onToggleAutoRadio}>
                  <Radio className="h-4 w-4" />
                  {autoRadio ? 'Auto-Radio ON' : 'Auto-Radio OFF'}
                </Button>
              </TooltipTrigger><TooltipContent><p>Find related songs when the playlist runs out</p></TooltipContent></Tooltip>
            </div>
          )}

          {activePanel === 'queue' && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-3 max-h-[30rem] overflow-y-auto">
              <PlaylistPanel playlist={playlist || []} currentTrackId={currentTrackId || ''} isPlayerControlAllowed={canControl} onPlaySong={onPlaySong} onRemoveSong={onRemoveSong} onClearPlaylist={onClearPlaylist} />
              {canControl && <AddMusicPanel onAddItems={onAddItems} onClose={() => setActivePanel(null)} canAddMusic={true} />}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
