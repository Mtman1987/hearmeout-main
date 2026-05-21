'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { MessageSquare, Music, ListMusic, Users, Mic, Volume2 } from 'lucide-react';
import * as LivekitClient from 'livekit-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { useDoc } from '@/hooks/use-db';
import { useRoomContext } from '@livekit/components-react';
import type { PlaylistItem } from '@/types/playlist';
import { dbUpdate } from '@/lib/db-helpers';
import { extractAudioUrl as extractBrowserAudioUrl } from '@/lib/yt-client-extract';

interface OverlayProps { participant: LivekitClient.Participant; roomId: string; }

export default function OverlayCard({ participant, roomId }: OverlayProps) {
  const { toast } = useToast();
  const room = useRoomContext();
  const { data: roomData } = useDoc<{ 
    overlayVisible?: { chat: boolean; music: boolean; queue: boolean }; 
    playlist?: any[];
    currentTrackId?: string; 
    isPlaying?: boolean;
  }>('rooms', roomId);
  
  const visible = roomData?.overlayVisible || { chat: true, music: true, queue: true };
  const currentTrack = roomData?.playlist?.find((t: any) => t.id === roomData?.currentTrackId);

  // Music voice state
  const [musicVoiceEnabled, setMusicVoiceEnabled] = useState(false);
  const [musicAudioLevel, setMusicAudioLevel] = useState(0);
  const [localVolume, setLocalVolume] = useState(0.8);
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicTrackRef = useRef<LivekitClient.LocalTrackPublication | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | undefined>(undefined);

  const toggleMusicVoice = useCallback(async () => {
    const newEnabled = !musicVoiceEnabled;
    setMusicVoiceEnabled(newEnabled);
    
    if (newEnabled && room && currentTrack) {
      try {
        // Setup music-only stream (no mic mix)
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const destination = audioContext.createMediaStreamDestination();

        // Create audio element
        const audioEl = new Audio();
        audioElementRef.current = audioEl;
        audioEl.crossOrigin = 'anonymous';
        audioEl.volume = localVolume;

        // Get audio URL
        const videoId = new URL(currentTrack.url).searchParams.get('v');
        if (!videoId) throw new Error('Invalid YouTube URL - missing video ID');
        
        console.log(`Loading music for videoId: ${videoId}`);
        const extracted = await extractBrowserAudioUrl(videoId);
        if (!extracted?.url) throw new Error('Browser extraction failed');

        const proxyRes = await fetch('/api/youtube-audio/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId, audioUrl: extracted.url, mimeType: extracted.mimeType }),
        });
        if (!proxyRes.ok) throw new Error(`Proxy registration failed (${proxyRes.status})`);

        const proxyData = await proxyRes.json().catch(() => null);
        const proxyUrl = proxyData?.proxyUrl || `/api/youtube-audio/proxy?videoId=${videoId}`;
        console.log(`Music source: ${proxyUrl}`);
        audioEl.src = proxyUrl;
        
        // Wait for load + play
        await new Promise<void>((resolve, reject) => {
          const onError = (e: Event) => {
            console.error('Audio load/play failed:', audioEl.error);
            reject(new Error(`Audio failed: ${audioEl.error?.message || 'Unknown error'} - source not supported`));
            audioEl.removeEventListener('error', onError);
            audioEl.removeEventListener('loadeddata', onLoaded);
          };
          const onLoaded = () => {
            audioEl.play().then(() => {
              audioEl.removeEventListener('error', onError);
              audioEl.removeEventListener('loadeddata', onLoaded);
              resolve();
            }).catch(reject);
          };
          
          audioEl.addEventListener('error', onError, { once: true });
          audioEl.addEventListener('loadeddata', onLoaded, { once: true });
          audioEl.addEventListener('loadstart', () => console.log('Audio load started'));
          
          // 10s timeout
          const timeout = setTimeout(() => {
            reject(new Error('Music load timeout'));
          }, 10000);
          
          audioEl.load();
        });

        // Music source → analyzer → destination
        const musicSource = audioContext.createMediaElementSource(audioEl);
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 256;
        analyzerRef.current = analyzer;
        musicSource.connect(analyzer);
        musicSource.connect(destination);

        // Fake speaking visualization
        const dataArray = new Uint8Array(analyzer.frequencyBinCount);
        const updateLevel = () => {
          analyzer.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setMusicAudioLevel(avg / 255);
          animationRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();

        // Publish as voice track
        const track = destination.stream.getAudioTracks()[0];
        musicTrackRef.current = await room.localParticipant.publishTrack(track, {
          name: 'overlay-music',
          source: LivekitClient.Track.Source.Unknown,
        });

        toast({ title: 'Overlay Music Active 🎵', description: `Playing: ${currentTrack.title.slice(0, 50)}` });
      } catch (e) {
        toast({ variant: 'destructive', title: 'Music Error', description: String(e) });
        setMusicVoiceEnabled(false);
      }
    } else if (musicTrackRef.current && room) {
      // Cleanup
      room.localParticipant.unpublishTrack(musicTrackRef.current.track!);
      musicTrackRef.current = null;
      if (audioContextRef.current) audioContextRef.current.close();
      if (audioElementRef.current) audioElementRef.current.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setMusicAudioLevel(0);
    }
  }, [room, currentTrack, musicVoiceEnabled, localVolume, roomId, toast]);

  const toggleOverlayWidget = (widget: 'music' | 'queue') => {
    const updated = { ...visible, [widget]: !visible[widget] };
    dbUpdate('rooms', roomId, { overlayVisible: updated });
  };

  useEffect(() => {
    return () => {
      if (musicTrackRef.current && room) {
        room.localParticipant.unpublishTrack(musicTrackRef.current.track!);
      }
      if (audioContextRef.current) audioContextRef.current.close();
      if (audioElementRef.current) audioElementRef.current?.pause();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const showHiddenUsers = () => {
    const saved = localStorage.getItem('overlay-hidden-users');
    if (saved) {
      localStorage.setItem('overlay-hidden-users', JSON.stringify([]));
      toast({ title: 'Profiles Restored' });
    }
  };

  // Cleanup on unmount
  useEffect(() => () => {
    if (musicTrackRef.current && room) {
      room.localParticipant.unpublishTrack(musicTrackRef.current.track!);
    }
  }, []);

  const isSpeaking = musicAudioLevel > 0.1;
  const albumArt = currentTrack?.thumbnail || 'https://picsum.photos/seed=music/80/80';

  return (
    <Card className="flex flex-col h-full relative">
      {isSpeaking && (
        <div className="absolute -inset-2 bg-gradient-to-r from-green-500/20 to-blue-500/20 rounded-2xl blur animate-pulse" />
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3 relative z-10">
          <div className="relative">
            <Avatar className={cn('h-16 w-16 transition-all duration-200', isSpeaking && 'ring-4 ring-green-400 ring-offset-2 ring-offset-background shadow-lg')}>
              <AvatarImage src={musicVoiceEnabled && albumArt ? albumArt : 'https://api.dicebear.com/7.x/shapes/svg?seed=overlay'} />
              <AvatarFallback>{musicVoiceEnabled ? '🎵' : 'OV'}</AvatarFallback>
              {musicVoiceEnabled && isSpeaking && <Mic className="absolute -bottom-1 -right-1 h-5 w-5 bg-green-500 p-1 rounded-full border-2 border-background animate-pulse" />}
            </Avatar>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg truncate">Overlay Bot</p>
            {currentTrack && (
              <p className="text-sm text-green-500 truncate">🎵 {currentTrack.title}</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 gap-3">
        <div className='flex items-center gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={musicVoiceEnabled ? 'secondary' : 'ghost'} size="icon" className="h-9 w-9" onClick={toggleMusicVoice}>
                {musicVoiceEnabled ? <Volume2 className="h-4 w-4" /> : <Music className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{musicVoiceEnabled ? 'Stop Music Voice' : 'Start Music Voice'}</p></TooltipContent>
          </Tooltip>
          <div className="flex-1 ml-2">
            <Slider 
              value={[localVolume]} 
              onValueChange={v => setLocalVolume(v[0])} 
              max={1} 
              step={0.05}
              className="h-3"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={visible.music ? "secondary" : "ghost"} size="icon" className="h-9 w-9" onClick={() => toggleOverlayWidget('music')}>
                <ListMusic className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{visible.music ? 'Hide' : 'Show'} Queue</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={showHiddenUsers}>
                <Users className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>Hidden Profiles</p></TooltipContent>
          </Tooltip>
        </div>
        {musicVoiceEnabled && musicAudioLevel > 0 && (
          <div className="text-xs text-green-500 flex items-center gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Music Level: {(musicAudioLevel * 100).toFixed(0)}%
          </div>
        )}
      </CardContent>
      {/* Hidden audio element */}
      {musicVoiceEnabled && <audio ref={audioElementRef} style={{ display: 'none' }} />}
    </Card>
  );
}
