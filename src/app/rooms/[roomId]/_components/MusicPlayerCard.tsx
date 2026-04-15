'use client';

import Image from "next/image";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward, Music, Youtube, ListMusic, Volume2, VolumeX } from "lucide-react";
import placeholderData from "@/lib/placeholder-images.json";
import { type PlaylistItem } from "@/types/playlist";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";

type MusicPlayerCardProps = {
  currentTrack: PlaylistItem | undefined;
  playing: boolean;
  isPlayerControlAllowed: boolean;
  onPlayPause: (playing: boolean) => void;
  onPlayNext: () => void;
  onPlayPrev: () => void;
  onTogglePanel?: (panel: 'playlist' | 'add') => void;
  activePanels?: { playlist: boolean, add: boolean };
  volume: number;
  onVolumeChange: (volume: number) => void;
  isDJ?: boolean;
  roomId?: string;
};

export default function MusicPlayerCard({
  currentTrack,
  playing,
  isPlayerControlAllowed,
  onPlayPause,
  onPlayNext,
  onPlayPrev,
  onTogglePanel,
  activePanels,
  volume,
  onVolumeChange,
}: MusicPlayerCardProps) {
  const albumArt = currentTrack?.thumbnail || (currentTrack ? placeholderData.placeholderImages.find(p => p.id === currentTrack.artId)?.imageUrl : undefined);
  const isMuted = volume === 0;
  const lastNonZeroVolume = React.useRef(volume);

  React.useEffect(() => { if (volume > 0) lastNonZeroVolume.current = volume; }, [volume]);

  const handlePlayPause = () => isPlayerControlAllowed && currentTrack && onPlayPause(!playing);
  const handlePlayNext = () => isPlayerControlAllowed && currentTrack && onPlayNext();
  const handlePlayPrev = () => isPlayerControlAllowed && currentTrack && onPlayPrev();
  const toggleMute = () => onVolumeChange(volume > 0 ? 0 : lastNonZeroVolume.current || 1);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="relative w-16 h-16 shrink-0">
            {albumArt ? (
              <Image src={albumArt} alt={currentTrack?.title || "Album Art"} fill sizes="64px" className="rounded-lg shadow-lg object-cover" unoptimized />
            ) : (
              <div className="w-full h-full rounded-lg shadow-lg bg-muted flex items-center justify-center"><Music className="w-8 h-8 text-muted-foreground" /></div>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <CardTitle className="font-headline text-lg flex items-center gap-2"><Music /> Now Playing</CardTitle>
            <p className="text-muted-foreground text-sm truncate">{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "No song selected"}</p>
            {playing && currentTrack && (
              <div className="mt-2 flex items-center gap-2 text-xs text-green-500">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Playing on overlay
              </div>
            )}
          </div>
          {isPlayerControlAllowed && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Tooltip><TooltipTrigger asChild>
                <Button variant={activePanels?.playlist ? "secondary" : "ghost"} size="icon" onClick={() => onTogglePanel?.('playlist')} className="h-8 w-8"><ListMusic className="h-4 w-4" /></Button>
              </TooltipTrigger><TooltipContent><p>Up Next</p></TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild>
                <Button variant={activePanels?.add ? "secondary" : "ghost"} size="icon" onClick={() => onTogglePanel?.('add')} className="h-8 w-8"><Youtube className="h-4 w-4" /></Button>
              </TooltipTrigger><TooltipContent><p>Add Music</p></TooltipContent></Tooltip>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-end gap-4 p-3 sm:p-4">
        <div className="flex items-center justify-center gap-1">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handlePlayPrev} disabled={!isPlayerControlAllowed || !currentTrack}><SkipBack /></Button>
          </TooltipTrigger><TooltipContent><p>Previous</p></TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button size="lg" className="h-12 w-12 rounded-full" onClick={handlePlayPause} disabled={!isPlayerControlAllowed || !currentTrack}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
          </TooltipTrigger><TooltipContent><p>{playing ? 'Pause' : 'Play'}</p></TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={handlePlayNext} disabled={!isPlayerControlAllowed || !currentTrack}><SkipForward /></Button>
          </TooltipTrigger><TooltipContent><p>Next</p></TooltipContent></Tooltip>
        </div>
        <div className="flex items-center gap-2 px-2">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger><TooltipContent><p>{isMuted ? "Unmute" : "Mute"}</p></TooltipContent></Tooltip>
          <Slider value={[volume]} onValueChange={(value) => onVolumeChange(value[0])} max={1} step={0.05} />
          <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(volume * 100)}%</span>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">Music plays on the OBS overlay — controls are remote</p>
      </CardContent>
    </Card>
  );
}
