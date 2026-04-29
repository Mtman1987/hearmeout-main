'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalAudioTrack, Room, Track } from 'livekit-client';
import { generateMusicRoomToken } from '@/app/actions';
import { dbUpdate } from '@/lib/db-helpers';
import type { PlaylistItem } from '@/types/playlist';

function extractVideoId(trackId: string, trackUrl?: string): string {
  if (trackUrl) {
    try {
      const u = new URL(trackUrl);
      return u.searchParams.get('v') || u.pathname.slice(1) || trackId;
    } catch {}
  }
  return trackId;
}

interface RoomData {
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  autoRadio?: boolean;
  playHistory?: string[];
}

/**
 * Embeds DJ publishing logic into the room page.
 * Plays audio via a hidden <audio> element, pipes it through WebAudio
 * to LiveKit (publish-only, no local monitor — the host hears via
 * LiveKit subscription like every other participant).
 */
export function useDJPublisher(
  roomId: string,
  roomData: RoomData | null,
  userId: string | null,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const publishDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const livekitRoomRef = useRef<Room | null>(null);
  const publishedTrackRef = useRef<LocalAudioTrack | null>(null);
  const lastTrackRef = useRef<string | null>(null);
  const liveRef = useRef(false);
  const autoRadioRequestedRef = useRef(false);
  const roomDataRef = useRef<RoomData | null>(null);

  const [isLive, setIsLive] = useState(false);
  const [status, setStatus] = useState('Ready');

  // Keep roomData ref in sync for use in event handlers
  useEffect(() => {
    roomDataRef.current = roomData;
  }, [roomData]);

  // Build WebAudio graph — publish branch only (no local monitor).
  const ensureAudioGraph = useCallback(async (): Promise<MediaStreamTrack | null> => {
    if (!audioRef.current) {
      audioRef.current = document.createElement('audio');
      audioRef.current.preload = 'auto';
    }
    const audioEl = audioRef.current;

    if (!audioContextRef.current) {
      const Ctx =
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
        window.AudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;

      const src = ctx.createMediaElementSource(audioEl);
      sourceNodeRef.current = src;

      const publishDest = ctx.createMediaStreamDestination();
      publishDestRef.current = publishDest;
      src.connect(publishDest);
      // No connection to ctx.destination — host hears via LiveKit subscription
    }

    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch {}
    }

    const tracks = publishDestRef.current!.stream.getAudioTracks();
    return tracks[0] || null;
  }, []);

  const connectLiveKit = useCallback(async (): Promise<void> => {
    if (livekitRoomRef.current) return;
    if (!userId) return;
    setStatus('Connecting to LiveKit...');

    const token = await generateMusicRoomToken(roomId, userId, 'HearMeOut DJ', true);
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!livekitUrl || !token) {
      setStatus('ERROR: LiveKit config missing');
      return;
    }

    const lkRoom = new Room();
    await lkRoom.connect(livekitUrl, token);
    livekitRoomRef.current = lkRoom;
    console.log('[DJ] LiveKit connected as', lkRoom.localParticipant.identity);
  }, [roomId, userId]);

  const publishTrackIfNeeded = useCallback(async (): Promise<void> => {
    if (publishedTrackRef.current) return;
    const lkRoom = livekitRoomRef.current;
    if (!lkRoom) return;

    const mediaTrack = await ensureAudioGraph();
    if (!mediaTrack) {
      setStatus('ERROR: could not build audio graph');
      return;
    }

    const localTrack = new LocalAudioTrack(mediaTrack, undefined, false);
    await lkRoom.localParticipant.publishTrack(localTrack, {
      name: 'music',
      source: Track.Source.Microphone,
    });
    publishedTrackRef.current = localTrack;
    liveRef.current = true;
    setIsLive(true);
    setStatus('broadcasting');
    console.log('[DJ] Music track published');
  }, [ensureAudioGraph]);

  const loadAndPlay = useCallback(async (videoId: string) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    const nextSrc = `/api/youtube-audio/stream?videoId=${encodeURIComponent(videoId)}`;
    if (audioEl.src !== new URL(nextSrc, window.location.origin).toString()) {
      audioEl.src = nextSrc;
      audioEl.load();
    }
    try {
      await audioEl.play();
    } catch (e) {
      console.warn('[DJ] audio.play() failed:', e);
    }
  }, []);

  const requestAutoRadio = useCallback(() => {
    if (autoRadioRequestedRef.current) return;
    autoRadioRequestedRef.current = true;
    fetch('/api/auto-radio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    })
      .then(async (res) => {
        try {
          const body = await res.json();
          if (!res.ok || !body?.success) autoRadioRequestedRef.current = false;
        } catch {
          autoRadioRequestedRef.current = false;
        }
      })
      .catch(() => {
        autoRadioRequestedRef.current = false;
      });
  }, [roomId]);

  const startSession = useCallback(async () => {
    try {
      await ensureAudioGraph();
      await connectLiveKit();
      await publishTrackIfNeeded();
      dbUpdate('rooms', roomId, { djActive: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DJ] startSession error:', err);
      setStatus(`ERROR: ${message}`);
    }
  }, [connectLiveKit, ensureAudioGraph, publishTrackIfNeeded, roomId]);

  const stopSession = useCallback(() => {
    try { publishedTrackRef.current?.stop(); } catch {}
    publishedTrackRef.current = null;

    try { livekitRoomRef.current?.disconnect(); } catch {}
    livekitRoomRef.current = null;

    const audioEl = audioRef.current;
    if (audioEl) {
      try { audioEl.pause(); } catch {}
      audioEl.removeAttribute('src');
      audioEl.load();
    }

    liveRef.current = false;
    lastTrackRef.current = null;
    setIsLive(false);
    setStatus('Ready');
    dbUpdate('rooms', roomId, { djActive: false, isPlaying: false });
  }, [roomId]);

  // React to room data changes (track changes, play/pause)
  useEffect(() => {
    if (!liveRef.current || !roomData) return;
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const { currentTrackId, isPlaying: wantPlay, playlist } = roomData;

    if (!currentTrackId) {
      if (!audioEl.paused) audioEl.pause();
      if (roomData.autoRadio) requestAutoRadio();
      return;
    }

    const track = playlist?.find(t => t.id === currentTrackId);
    const videoId = extractVideoId(currentTrackId, track?.url);

    if (lastTrackRef.current !== currentTrackId) {
      lastTrackRef.current = currentTrackId;
      autoRadioRequestedRef.current = false;
      if (wantPlay) loadAndPlay(videoId);
    } else {
      // Same track — sync play/pause, but don't restart ended tracks
      if (wantPlay && audioEl.paused && !audioEl.ended) {
        audioEl.play().catch(() => {});
      } else if (!wantPlay && !audioEl.paused) {
        audioEl.pause();
      }
    }

    // Fallback auto-advance when onEnded doesn't fire
    if (
      wantPlay &&
      audioEl.duration &&
      Number.isFinite(audioEl.duration) &&
      audioEl.currentTime >= audioEl.duration - 0.5 &&
      audioEl.paused
    ) {
      const idx = playlist?.findIndex(t => t.id === currentTrackId) ?? -1;
      const isLastTrack = playlist ? idx === playlist.length - 1 : false;

      if (roomData.autoRadio && isLastTrack) {
        requestAutoRadio();
      } else {
        const next = playlist?.[(idx + 1) % playlist.length];
        if (next && next.id !== currentTrackId) {
          const updates: Record<string, unknown> = { currentTrackId: next.id, isPlaying: true };
          if (currentTrackId) {
            updates.playHistory = [...(roomData.playHistory || []), currentTrackId].slice(-50);
          }
          dbUpdate('rooms', roomId, updates);
        }
      }
    }
  }, [roomData, roomId, loadAndPlay, requestAutoRadio]);

  // Auto-advance when a track naturally ends
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !isLive) return;

    const handleEnded = () => {
      const r = roomDataRef.current;
      if (!r?.playlist?.length) {
        if (r?.autoRadio) requestAutoRadio();
        return;
      }
      const i = r.playlist.findIndex(t => t.id === r.currentTrackId);
      const isLastTrack = i === r.playlist.length - 1;

      if (isLastTrack && r.autoRadio) {
        requestAutoRadio();
        return;
      }

      const next = r.playlist[(i + 1) % r.playlist.length];
      if (!next) return;
      const updates: Record<string, unknown> = { currentTrackId: next.id, isPlaying: true };
      if (r.currentTrackId) {
        updates.playHistory = [...(r.playHistory || []), r.currentTrackId].slice(-50);
      }
      dbUpdate('rooms', roomId, updates);
    };

    audioEl.addEventListener('ended', handleEnded);
    return () => audioEl.removeEventListener('ended', handleEnded);
  }, [isLive, roomId, requestAutoRadio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { publishedTrackRef.current?.stop(); } catch {}
      try { livekitRoomRef.current?.disconnect(); } catch {}
      try { audioContextRef.current?.close(); } catch {}
      if (liveRef.current) {
        dbUpdate('rooms', roomId, { djActive: false });
      }
    };
  }, [roomId]);

  return { startSession, stopSession, isLive, status };
}
