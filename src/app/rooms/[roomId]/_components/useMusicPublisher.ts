'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Room } from 'livekit-client';
import * as LivekitClient from 'livekit-client';
import { PlaylistItem } from '@/types/playlist';

export function useMusicPublisher(room: Room | null, track: PlaylistItem | undefined, enabled: boolean, volume: number) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicTrackRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const publishMusic = useCallback(async () => {
    if (!room || !track || !enabled) return;

    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      const audioEl = new Audio();
      audioElRef.current = audioEl;
      audioEl.crossOrigin = 'anonymous';
      audioEl.volume = volume;

      let videoId = track.id;
      try {
        const parsed = new URL(track.url);
        videoId = parsed.searchParams.get('v') || parsed.pathname.slice(1) || track.id;
      } catch {}
      if (!videoId) throw new Error('Invalid track - missing video ID');
      
      console.log(`[MusicPublisher] Loading for ${videoId}`);
      const videoUrl = track.url || `https://youtube.com/watch?v=${videoId}`;
      const res = await fetch(`/api/youtube-audio?videoId=${videoId}&url=${encodeURIComponent(videoUrl)}`);
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      
      const data = await res.json();
      if (data.error || !data.audioUrl) throw new Error(`No valid source: ${data.error || 'Missing audioUrl'}`);
      
      console.log(`[MusicPublisher] Source: ${data.audioUrl.substring(0, 80)}...`);
      audioEl.src = data.audioUrl;
      
      // Load + play with validation
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Music load timeout')), 10000);
        
        audioEl.onloadeddata = () => {
          clearTimeout(timeout);
          audioEl.play().then(resolve).catch(reject);
        };
        audioEl.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error(`Audio error: ${audioEl.error?.message || 'Source not supported'}`));
        };
        
        audioEl.load();
      });

      const source = audioContext.createMediaElementSource(audioEl);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      analyzerRef.current = analyzer;
      source.connect(analyzer);
      source.connect(destination);

      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      const updateLevel = () => {
        analyzer.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        rafRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const trackPub = await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0]!, {
        name: 'music',
        source: LivekitClient.Track.Source.Music,
      });
      musicTrackRef.current = trackPub;
    } catch (e) {
      console.error('Music publish failed:', e);
    }
  }, [room, track, enabled, volume]);

  useEffect(() => {
    if (enabled) {
      publishMusic();
    }
    return () => {
      if (musicTrackRef.current) {
        room?.localParticipant.unpublishTrack(musicTrackRef.current.track);
      }
      if (audioContextRef.current) audioContextRef.current.close();
      if (audioElRef.current) audioElRef.current.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [publishMusic]);

  return { audioLevel, musicTrackRef: musicTrackRef.current };
}
