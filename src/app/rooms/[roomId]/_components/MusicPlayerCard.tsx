'use client';

import Image from "next/image";
import React, { useRef, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music,
  Youtube,
  ListMusic,
  Volume2,
  VolumeX,
} from "lucide-react";
import placeholderData from "@/lib/placeholder-images.json";
import { type PlaylistItem } from "@/types/playlist";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { useRoomContext } from '@livekit/components-react';
import * as LivekitClient from 'livekit-client';

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
  isDJ = false,
  roomId
}: MusicPlayerCardProps) {
  const room = useRoomContext();
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicTrackRef = useRef<LivekitClient.LocalTrackPublication | null>(null);
  const [audioStreamUrl, setAudioStreamUrl] = useState<string | null>(null);
  const [musicDevices, setMusicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMusicDevice, setSelectedMusicDevice] = useState<string>('');
  const [isMusicPublished, setIsMusicPublished] = useState(false);
  const [musicAudioLevel, setMusicAudioLevel] = useState(0);
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  const albumArt = currentTrack ? placeholderData.placeholderImages.find(p => p.id === currentTrack.artId) : undefined;
  const isMuted = volume === 0;
  const lastNonZeroVolume = React.useRef(volume);

  React.useEffect(() => {
    if(volume > 0) {
      lastNonZeroVolume.current = volume;
    }
  }, [volume])

  // Get available audio input devices for music
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      setMusicDevices(audioInputs);
      
      // Load saved device from localStorage
      const saved = localStorage.getItem('musicDevice');
      if (saved && audioInputs.some(d => d.deviceId === saved)) {
        setSelectedMusicDevice(saved);
      }
    });
  }, []);

  // Publish music track when device selected and playing
  useEffect(() => {
    if (!isDJ || !room || !selectedMusicDevice) return;

    const publishMusicTrack = async () => {
      try {
        if (playing) {
          // Only publish if not already published
          if (musicTrackRef.current) {
            // Update volume on existing track
            const audioTrack = musicTrackRef.current.audioTrack;
            if (audioTrack) {
              await audioTrack.setVolume(volume);
            }
            return;
          }
          
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: selectedMusicDevice } }
          });
          
          const track = stream.getAudioTracks()[0];
          
          // Set up audio analyzer
          const audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          const analyzer = audioContext.createAnalyser();
          analyzer.fftSize = 256;
          source.connect(analyzer);
          audioAnalyzerRef.current = analyzer;
          
          // Monitor audio levels
          const dataArray = new Uint8Array(analyzer.frequencyBinCount);
          const updateLevel = () => {
            analyzer.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setMusicAudioLevel(average / 255);
            animationFrameRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
          
          musicTrackRef.current = await room.localParticipant.publishTrack(track, {
            name: 'music',
            source: LivekitClient.Track.Source.Unknown,
          });
          
          // Set initial volume
          const audioTrack = musicTrackRef.current.audioTrack;
          if (audioTrack) {
            await audioTrack.setVolume(volume);
          }
          
          setIsMusicPublished(true);
          console.log('Music track published with volume:', volume);
        } else {
          // Unpublish when paused
          if (musicTrackRef.current) {
            await room.localParticipant.unpublishTrack(musicTrackRef.current.track!);
            musicTrackRef.current = null;
            setIsMusicPublished(false);
            setMusicAudioLevel(0);
            if (animationFrameRef.current) {
              cancelAnimationFrame(animationFrameRef.current);
            }
            console.log('Music track unpublished');
          }
        }
      } catch (e) {
        console.error('Failed to publish music:', e);
      }
    };

    publishMusicTrack();

    return () => {
      if (musicTrackRef.current) {
        room.localParticipant.unpublishTrack(musicTrackRef.current.track!).catch(console.error);
        musicTrackRef.current = null;
      }
    };
  }, [isDJ, room, selectedMusicDevice, playing, volume]);

  const handlePlayPause = () => isPlayerControlAllowed && currentTrack && onPlayPause(!playing);
  const handlePlayNextWithTrack = () => isPlayerControlAllowed && currentTrack && onPlayNext();
  const handlePlayPrevWithTrack = () => isPlayerControlAllowed && currentTrack && onPlayPrev();
  
  const toggleMute = () => {
    onVolumeChange(volume > 0 ? 0 : lastNonZeroVolume.current || 1);
  };

  // Auto-play YouTube when track changes
  useEffect(() => {
    if (!isDJ || !currentTrack?.url || !playing) return;
    
    const videoId = new URL(currentTrack.url).searchParams.get('v');
    if (videoId && iframeRef.current) {
      iframeRef.current.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0`;
    }
  }, [isDJ, currentTrack?.url, playing]);
  
  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <div className="flex items-start gap-4">
            <div className="relative w-16 h-16 shrink-0">
              {albumArt ? (
                  <Image
                      src={albumArt.imageUrl}
                      alt={currentTrack?.title || "Album Art"}
                      fill
                      sizes="64px"
                      className="rounded-lg shadow-lg object-cover"
                      data-ai-hint={albumArt.imageHint}
                  />
              ) : (
                  <div className="w-full h-full rounded-lg shadow-lg bg-muted flex items-center justify-center">
                      <Music className="w-8 h-8 text-muted-foreground" />
                  </div>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
                <CardTitle className="font-headline text-lg flex items-center gap-2">
                    <Music /> Now Playing
                </CardTitle>
                <p className="text-muted-foreground text-sm truncate">{currentTrack ? `${currentTrack.title} - ${currentTrack.artist}` : "No song selected"}</p>
                {isDJ && (
                  <div className="mt-2 space-y-2">
                    <select 
                      value={selectedMusicDevice} 
                      onChange={(e) => {
                        setSelectedMusicDevice(e.target.value);
                        localStorage.setItem('musicDevice', e.target.value);
                      }}
                      className="w-full text-xs bg-background border rounded px-2 py-1"
                    >
                      <option value="">Select Music Device</option>
                      {musicDevices.map(device => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                    {isMusicPublished && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-green-500">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          Music streaming active
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Audio Level</div>
                          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-green-500 transition-all duration-75"
                              style={{ width: `${musicAudioLevel * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </div>
            {isPlayerControlAllowed && (
                <div className="flex items-center gap-1 text-muted-foreground">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant={activePanels?.playlist ? "secondary" : "ghost"} size="icon" onClick={() => onTogglePanel?.('playlist')} aria-label="Toggle Playlist" className="h-8 w-8">
                                <ListMusic className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Up Next</p>
                        </TooltipContent>
                    </Tooltip>
                     <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant={activePanels?.add ? "secondary" : "ghost"} size="icon" onClick={() => onTogglePanel?.('add')} aria-label="Add Music" className="h-8 w-8">
                                <Youtube className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Add Music</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-end gap-4 p-3 sm:p-4">
        <div className="flex items-center justify-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handlePlayPrevWithTrack} disabled={!isPlayerControlAllowed || !currentTrack}>
                      <SkipBack />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Previous</p>
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button size="lg" className="h-12 w-12 rounded-full" onClick={handlePlayPause} disabled={!isPlayerControlAllowed || !currentTrack}>
                      {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{playing ? 'Pause' : 'Play'}</p>
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handlePlayNextWithTrack} disabled={!isPlayerControlAllowed || !currentTrack}>
                      <SkipForward/>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Next</p>
                </TooltipContent>
            </Tooltip>
        </div>
        
        <div className="flex items-center gap-2 px-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
                        {isMuted ? <VolumeX className="h-4 w-4"/> : <Volume2 className="h-4 w-4"/>}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{isMuted ? "Unmute" : "Mute"}</p>
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
      {/* Hidden YouTube player */}
      {isDJ && <iframe ref={iframeRef} style={{ display: 'none' }} allow="autoplay" />}
    </Card>
  );
}
