'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type MusicStreamerCardProps = {
  audioRef: React.RefObject<HTMLAudioElement>;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onTrackEnd: () => void;
};

export default function MusicStreamerCard({
  audioRef,
  volume,
  onVolumeChange,
  onTrackEnd
}: MusicStreamerCardProps) {
  const isMuted = volume === 0;
  const lastNonZeroVolume = React.useRef(volume);

  React.useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolume.current = volume;
    }
  }, [volume]);

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  const toggleMute = () => {
    onVolumeChange(volume > 0 ? 0 : lastNonZeroVolume.current || 0.5);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline text-lg flex items-center gap-2">
          <Music /> Music Stream
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <audio ref={audioRef} onEnded={onTrackEnd} crossOrigin="anonymous" controls className="w-full" />
        
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMuted ? 'Unmute' : 'Mute'}</p>
            </TooltipContent>
          </Tooltip>
          <Slider
            value={[volume]}
            onValueChange={(value) => onVolumeChange(value[0])}
            max={1}
            step={0.05}
          />
        </div>
      </CardContent>
    </Card>
  );
}
