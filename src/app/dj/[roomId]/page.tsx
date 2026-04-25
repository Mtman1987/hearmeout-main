'use client';

// DJ Popup — plays audio server-side (yt-dlp/Piped → /api/youtube-audio/stream)
// and publishes it to the LiveKit music room as a regular audio track (WebRTC).
//
// Listeners at /rooms/[roomId] already subscribe to this room's audio and render
// it like any voice track, so audio is sample-accurate synchronised across every
// client (there is no per-client playback — everyone hears the DJ's live stream).
//
// No getDisplayMedia, no shared-tab UX. The DJ just clicks "Start" once and the
// playlist advances automatically, controlled from the main room (or chat bots).

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalAudioTrack, Room, Track } from 'livekit-client';

interface RoomData {
  playlist: Array<{ id: string; url: string; title: string; artist: string }>;
  currentTrackId: string;
  isPlaying: boolean;
  djActive: boolean;
  autoRadio?: boolean;
  playHistory?: string[];
}

function extractVideoId(trackId: string, trackUrl?: string): string {
  if (trackUrl) {
    try {
      const u = new URL(trackUrl);
      return u.searchParams.get('v') || u.pathname.slice(1) || trackId;
    } catch {}
  }
  return trackId;
}

export default function DJPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  // Audio graph refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const publishDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // LiveKit refs
  const livekitRoomRef = useRef<Room | null>(null);
  const publishedTrackRef = useRef<LocalAudioTrack | null>(null);

  // Room-state refs
  const roomDataRef = useRef<RoomData | null>(null);
  const lastTrackRef = useRef<string | null>(null);
  const liveRef = useRef(false);
  const autoRadioRequestedRef = useRef(false);

  const [status, setStatus] = useState('Click "Start DJ Session" to begin');
  const [currentTrack, setCurrentTrack] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isPlayingLocal, setIsPlayingLocal] = useState(false);
  const [monitorVolume, setMonitorVolume] = useState(0.6);
  const [monitorMuted, setMonitorMuted] = useState(true);
  const monitorVolumeRef = useRef(monitorVolume);
  const monitorMutedRef = useRef(monitorMuted);
  useEffect(() => { monitorVolumeRef.current = monitorVolume; }, [monitorVolume]);
  useEffect(() => { monitorMutedRef.current = monitorMuted; }, [monitorMuted]);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    document.title = isLive ? '🔴 DJ LIVE — HearMeOut' : '🎵 HearMeOut DJ';
  }, [isLive]);

  // Keep monitor gain in sync with UI controls (only affects DJ's own ears)
  useEffect(() => {
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = monitorMuted ? 0 : monitorVolume;
    }
  }, [monitorVolume, monitorMuted]);

  // Build the WebAudio graph once, on first user gesture, so autoplay rules are
  // satisfied and we can also capture a MediaStreamTrack from the <audio> element.
  const ensureAudioGraph = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const audioEl = audioRef.current;
    if (!audioEl) return null;

    if (!audioContextRef.current) {
      const Ctx =
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
        window.AudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;

      // Single source feeding two branches:
      //   1. Publish branch  → MediaStreamAudioDestinationNode (goes to LiveKit, always unity gain)
      //   2. Monitor branch  → GainNode → ctx.destination (DJ hears it locally, independent volume)
      const src = ctx.createMediaElementSource(audioEl);
      sourceNodeRef.current = src;

      const publishDest = ctx.createMediaStreamDestination();
      publishDestRef.current = publishDest;
      src.connect(publishDest);

      const monitorGain = ctx.createGain();
      monitorGain.gain.value = monitorMutedRef.current ? 0 : monitorVolumeRef.current;
      monitorGainRef.current = monitorGain;
      src.connect(monitorGain);
      monitorGain.connect(ctx.destination);
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
    setStatus('Connecting to LiveKit...');

    const tokenRes = await fetch('/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        userId: 'HearMeOutDJ',
        userName: 'HearMeOut DJ',
        musicRoom: true,
        isDJ: true,
      }),
    });
    const { token } = await tokenRes.json();
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!livekitUrl || !token) {
      setStatus('ERROR: LiveKit config missing');
      return;
    }

    const lkRoom = new Room();
    await lkRoom.connect(livekitUrl, token);
    livekitRoomRef.current = lkRoom;
    console.log('[DJ] LiveKit connected as', lkRoom.localParticipant.identity);
  }, [roomId]);

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
      // Use Microphone source so existing listener code (which is keyed on
      // Microphone/Unknown) picks it up exactly like a voice track.
      source: Track.Source.Microphone,
    });
    publishedTrackRef.current = localTrack;
    liveRef.current = true;
    setIsLive(true);
    setStatus('🔴 LIVE — broadcasting via WebRTC to every listener');
    console.log('[DJ] Music track published');
  }, [ensureAudioGraph]);

  const startSession = useCallback(async () => {
    try {
      // Prime AudioContext on this user gesture (required by autoplay rules)
      await ensureAudioGraph();
      await connectLiveKit();
      await publishTrackIfNeeded();

      fetch('/api/db', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'rooms',
          id: roomId,
          data: { djActive: true },
        }),
      }).catch(() => {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DJ] startSession error:', err);
      setStatus(`ERROR: ${message}`);
    }
  }, [connectLiveKit, ensureAudioGraph, publishTrackIfNeeded, roomId]);

  const stopSession = useCallback(() => {
    try {
      publishedTrackRef.current?.stop();
    } catch {}
    publishedTrackRef.current = null;

    try {
      livekitRoomRef.current?.disconnect();
    } catch {}
    livekitRoomRef.current = null;

    const audioEl = audioRef.current;
    if (audioEl) {
      try {
        audioEl.pause();
      } catch {}
      audioEl.removeAttribute('src');
      audioEl.load();
    }

    liveRef.current = false;
    setIsLive(false);
    setStatus('Session stopped');

    fetch('/api/db', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'rooms',
        id: roomId,
        data: { djActive: false, isPlaying: false },
      }),
    }).catch(() => {});
  }, [roomId]);

  // Load a new video's audio stream into the audio element
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
      console.warn('[DJ] audio.play() failed (will retry on next poll):', e);
    }
  }, []);

  // Fire a single /api/auto-radio request, deduped by autoRadioRequestedRef.
  // The ref stays true until either a new currentTrackId is observed (cleared
  // by the poller) or the request fails / returns success:false (cleared here),
  // so a failed lookup doesn't permanently disable auto-radio for the session.
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
          if (!res.ok || !body?.success) {
            autoRadioRequestedRef.current = false;
          }
        } catch {
          autoRadioRequestedRef.current = false;
        }
      })
      .catch(() => {
        autoRadioRequestedRef.current = false;
      });
  }, [roomId]);

  // Poll room document for state changes (bots, room UI, chat can all drive this)
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/db?collection=rooms&id=${roomId}`);
        const result = await res.json();
        if (cancelled || !result?.exists) return;

        const data = result.data as RoomData;
        roomDataRef.current = data;

        const audioEl = audioRef.current;
        if (!audioEl) return;

        const { currentTrackId, isPlaying: wantPlay, playlist } = data;

        if (!currentTrackId) {
          if (!audioEl.paused) audioEl.pause();
          setCurrentTrack('');
          if (data.autoRadio && liveRef.current) {
            requestAutoRadio();
          }
          return;
        }

        const track = playlist?.find((t) => t.id === currentTrackId);
        const videoId = extractVideoId(currentTrackId, track?.url);

        if (lastTrackRef.current !== currentTrackId) {
          lastTrackRef.current = currentTrackId;
          autoRadioRequestedRef.current = false;
          setCurrentTrack(track?.title || videoId);
          if (wantPlay && liveRef.current) {
            await loadAndPlay(videoId);
          }
        } else if (liveRef.current) {
          // Don't resurrect a naturally-ended track: while auto-radio is
          // searching for the next song, audioEl is paused+ended but the DB
          // still shows the same currentTrackId with isPlaying:true. Playing
          // here would restart the track from the beginning for everyone.
          if (wantPlay && audioEl.paused && !audioEl.ended) {
            try {
              await audioEl.play();
            } catch {}
          } else if (!wantPlay && !audioEl.paused) {
            audioEl.pause();
          }
        }

        // Fallback auto-advance: if audio has ended (or is very close to end) and we think we're playing
        if (wantPlay && liveRef.current && audioEl.duration && Number.isFinite(audioEl.duration) && audioEl.currentTime >= audioEl.duration - 0.5 && audioEl.paused) {
          // Track ended but onEnded didn't fire — advance manually.
          // Defer to auto-radio on the last track when it's enabled: calling
          // handleEnded ensures we either queue a new track via the API or
          // advance normally, matching the onEnded path and avoiding a race
          // where the fallback wraps the playlist while auto-radio is searching.
          const idx = playlist?.findIndex((t) => t.id === currentTrackId) ?? -1;
          const isLastTrack = playlist ? idx === playlist.length - 1 : false;

          if (data.autoRadio && isLastTrack) {
            requestAutoRadio();
          } else {
            const next = playlist?.[(idx + 1) % playlist.length];
            if (next && next.id !== currentTrackId) {
              fetch('/api/db', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection: 'rooms', id: roomId, data: { currentTrackId: next.id, isPlaying: true } }),
              }).catch(() => {});
            }
          }
        }
      } catch {
        /* poll errors are non-fatal */
      }
    };

    poll();
    const iv = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [roomId, loadAndPlay, requestAutoRadio]);

  // Auto-advance when a track ends
  const handleEnded = useCallback(() => {
    const r = roomDataRef.current;
    if (!r?.playlist?.length) {
      if (r?.autoRadio) {
        requestAutoRadio();
      }
      return;
    }
    const i = r.playlist.findIndex((t) => t.id === r.currentTrackId);
    const isLastTrack = i === r.playlist.length - 1;

    if (isLastTrack && r.autoRadio) {
      requestAutoRadio();
      return;
    }

    const next = r.playlist[(i + 1) % r.playlist.length];
    if (!next) return;
    fetch('/api/db', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'rooms',
        id: roomId,
        data: { currentTrackId: next.id, isPlaying: true },
      }),
    }).catch(() => {});
  }, [roomId, requestAutoRadio]);

  const skipNext = useCallback(() => {
    handleEnded();
  }, [handleEnded]);

  const skipPrev = useCallback(() => {
    const r = roomDataRef.current;
    if (!r?.playlist?.length) return;
    const i = r.playlist.findIndex((t) => t.id === r.currentTrackId);
    const prev = r.playlist[(i - 1 + r.playlist.length) % r.playlist.length];
    if (!prev) return;
    fetch('/api/db', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'rooms',
        id: roomId,
        data: { currentTrackId: prev.id, isPlaying: true },
      }),
    }).catch(() => {});
  }, [roomId]);

  const togglePlayPause = useCallback(() => {
    const cur = roomDataRef.current;
    const wantPlay = !(cur?.isPlaying ?? false);
    fetch('/api/db', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'rooms',
        id: roomId,
        data: { isPlaying: wantPlay },
      }),
    }).catch(() => {});
  }, [roomId]);

  const seekTo = useCallback((seconds: number) => {
    const audioEl = audioRef.current;
    if (!audioEl || !Number.isFinite(seconds)) return;
    try {
      audioEl.currentTime = seconds;
    } catch {}
  }, []);

  useEffect(() => {
    (window as any).__HEARMEOUT_DJ__ = { startSession, stopSession };

    const recoverPlayback = async () => {
      if (!liveRef.current) return;

      try {
        await audioContextRef.current?.resume();
      } catch {}

      const audioEl = audioRef.current;
      if (audioEl && roomDataRef.current?.isPlaying && audioEl.paused && !audioEl.ended) {
        try {
          await audioEl.play();
        } catch {}
      }
    };

    const handleVisibilityRecovery = () => {
      if (!document.hidden) {
        void recoverPlayback();
      }
    };

    window.addEventListener('focus', handleVisibilityRecovery);
    window.addEventListener('pageshow', handleVisibilityRecovery);
    document.addEventListener('visibilitychange', handleVisibilityRecovery);

    return () => {
      if ((window as any).__HEARMEOUT_DJ__) {
        delete (window as any).__HEARMEOUT_DJ__;
      }
      window.removeEventListener('focus', handleVisibilityRecovery);
      window.removeEventListener('pageshow', handleVisibilityRecovery);
      document.removeEventListener('visibilitychange', handleVisibilityRecovery);
    };
  }, [startSession, stopSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        publishedTrackRef.current?.stop();
      } catch {}
      try {
        livekitRoomRef.current?.disconnect();
      } catch {}
      try {
        audioContextRef.current?.close();
      } catch {}
      fetch('/api/db', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'rooms',
          id: roomId,
          data: { djActive: false },
        }),
      }).catch(() => {});
    };
  }, [roomId]);

  return (
    <div
      style={{
        background: '#111',
        color: '#fff',
        fontFamily: 'system-ui',
        minHeight: '100vh',
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>🎵 HearMeOut DJ</h2>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: isLive ? '#dc2626' : '#333',
            color: isLive ? '#fff' : '#999',
          }}
        >
          {isLive ? '🔴 LIVE' : 'OFF AIR'}
        </span>
      </div>

      <p
        style={{
          fontSize: 12,
          color: status.includes('ERROR')
            ? '#f87171'
            : status.includes('LIVE')
              ? '#4ade80'
              : '#999',
          margin: '0 0 12px',
        }}
      >
        {status}
      </p>

      {!isLive ? (
        <button
          onClick={startSession}
          style={{
            width: '100%',
            padding: '14px',
            marginBottom: 12,
            border: 'none',
            borderRadius: 6,
            background: '#16a34a',
            color: '#fff',
            fontSize: 16,
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          ▶ Start DJ Session
        </button>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 2fr 1fr 1fr',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <button onClick={skipPrev} style={controlBtn}>
              ⏮
            </button>
            <button onClick={togglePlayPause} style={{ ...controlBtn, background: '#7c3aed' }}>
              {isPlayingLocal ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={skipNext} style={controlBtn}>
              ⏭
            </button>
            <button onClick={stopSession} style={{ ...controlBtn, background: '#dc2626' }}>
              ⏹
            </button>
          </div>

          <div style={{ marginBottom: 12, fontSize: 12, color: '#bbb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{formatTime(position)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(position, duration || 0)}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              disabled={!duration}
              aria-label="Seek through the current track"
              title="Seek through the current track"
              style={{ width: '100%' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              fontSize: 12,
              color: '#bbb',
            }}
          >
            <button
              onClick={() => setMonitorMuted((m) => !m)}
              style={{ ...controlBtn, width: 40, padding: 6, background: '#333' }}
              title="Mute your local monitor (listeners are unaffected)"
            >
              {monitorMuted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={monitorVolume}
              onChange={(e) => setMonitorVolume(parseFloat(e.target.value))}
              style={{ flex: 1 }}
              aria-label="Monitor volume"
              title="Adjust your local monitor volume"
            />
            <span style={{ width: 36, textAlign: 'right' }}>
              {Math.round(monitorVolume * 100)}%
            </span>
          </div>
        </>
      )}

      {currentTrack && (
        <p style={{ fontSize: 13, color: '#a78bfa', margin: '0 0 12px' }}>
          🎵 Now Playing: {currentTrack}
        </p>
      )}

      {/*
        Hidden audio element — we capture its decoded output via WebAudio and
        publish that as the LiveKit track. It's not rendered to the DOM because
        the DJ monitors through the WebAudio graph (separate volume control).
      */}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlayingLocal(true)}
        onPause={() => setIsPlayingLocal(false)}
        onEnded={handleEnded}
        onLoadedMetadata={(e) => setDuration((e.currentTarget.duration) || 0)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        preload="auto"
      />

      {!isLive && (
        <div
          style={{
            marginTop: 16,
            background: '#1a1a2e',
            borderRadius: 8,
            padding: 14,
            fontSize: 13,
            color: '#888',
            lineHeight: 1.8,
          }}
        >
          <p style={{ color: '#fff', fontWeight: 'bold', margin: '0 0 6px' }}>How it works</p>
          <p style={{ margin: 0 }}>1️⃣ Click <strong style={{ color: '#4ade80' }}>Start DJ Session</strong> above.</p>
          <p style={{ margin: 0 }}>2️⃣ Audio is fetched server-side (yt-dlp) and streamed to your browser.</p>
          <p style={{ margin: 0 }}>3️⃣ Your browser re-publishes it to LiveKit over WebRTC.</p>
          <p style={{ margin: 0 }}>4️⃣ Every listener hears the exact same live stream — in sync, like voice.</p>
          <p style={{ margin: '8px 0 0', color: '#666', fontSize: 11 }}>
            No tab sharing required. Keep this tab open while DJing.
          </p>
        </div>
      )}
    </div>
  );
}

const controlBtn: React.CSSProperties = {
  padding: 10,
  border: 'none',
  borderRadius: 6,
  background: '#222',
  color: '#fff',
  fontSize: 14,
  fontWeight: 'bold',
  cursor: 'pointer',
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
