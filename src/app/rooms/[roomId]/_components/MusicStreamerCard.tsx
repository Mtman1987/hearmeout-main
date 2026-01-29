'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRoomContext } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';

type MusicStreamerCardProps = {
  trackUrl?: string;
  isPlaying: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onTrackEnd: () => void;
};

export default function MusicStreamerCard({
  trackUrl,
  isPlaying,
  volume,
  onVolumeChange,
  onTrackEnd
}: MusicStreamerCardProps) {
  const room = useRoomContext();
  const audioRef = useRef<HTMLAudioElement>(null);
  const publicationRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const [audioStreamUrl, setAudioStreamUrl] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  
  const isMuted = volume === 0;
  const lastNonZeroVolume = useRef(volume);

  useEffect(() => {
    if (volume > 0) lastNonZeroVolume.current = volume;
  }, [volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!trackUrl) {
      setAudioStreamUrl(null);
      return;
    }

    let cancelled = false;
    setIsFetching(true);
    
    fetch(`/api/youtube-audio?url=${encodeURIComponent(trackUrl)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && audioRef.current) {
          audioRef.current.src = data.url;
          setAudioStreamUrl(data.url);
          setIsFetching(false);
        }
      })
      .catch(e => {
        console.error('Failed to get audio URL:', e);
        if (!cancelled) setIsFetching(false);
      });

    return () => { cancelled = true; };
  }, [trackUrl]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!room || !audioEl || !audioStreamUrl || !isPlaying) return;

    const broadcast = async () => {
      await audioEl.play();

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioEl);
        destinationRef.current = audioContextRef.current.createMediaStreamDestination();
        sourceNodeRef.current.connect(destinationRef.current);
        sourceNodeRef.current.connect(audioContextRef.current.destination);
      }

      const track = destinationRef.current!.stream.getAudioTracks()[0];
      publicationRef.current = await room.localParticipant.publishTrack(track, {
        name: 'music',
        source: LivekitClient.Track.Source.Microphone,
      });
    };

    broadcast();

    return () => {
      audioEl.pause();
      if (publicationRef.current) {
        room.localParticipant.unpublishTrack(publicationRef.current.track!);
      }
    };
  }, [room, audioStreamUrl, isPlaying]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline text-lg flex items-center gap-2">
          <Music /> Music Stream
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <audio ref={audioRef} onEnded={onTrackEnd} controls className="w-full" />
        
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onVolumeChange(isMuted ? lastNonZeroVolume.current : 0)}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMuted ? 'Unmute' : 'Mute'}</p>
            </TooltipContent>
          </Tooltip>
          <Slider value={[volume]} onValueChange={(v) => onVolumeChange(v[0])} max={1} step={0.05} />
        </div>
      </CardContent>
    </Card>
  );
}
