'use client';

// DJ Popup — opens as a small window from the DJCard
// YouTube IFrame API plays videos natively (no extraction, no CORS, no proxy)
// getDisplayMedia captures THIS tab's audio
// AudioContext sends captured audio to LiveKit music room
// Everyone subscribes and hears it synced

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Room, Track, LocalAudioTrack } from 'livekit-client';

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void; }
}

interface RoomData {
  playlist: Array<{ id: string; url: string; title: string; artist: string }>;
  currentTrackId: string;
  isPlaying: boolean;
  djActive: boolean;
}

function loadYTApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const check = setInterval(() => { if (window.YT?.Player) { clearInterval(check); resolve(); } }, 100);
      return;
    }
    window.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
}

export default function DJPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;

  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const livekitRoomRef = useRef<Room | null>(null);
  const publishedTrackRef = useRef<LocalAudioTrack | null>(null);
  const roomDataRef = useRef<RoomData | null>(null);
  const lastTrackRef = useRef<string | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState('Loading YouTube player...');
  const [currentTrack, setCurrentTrack] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [ytReady, setYtReady] = useState(false);

  // Set tab title so it's obvious in the share picker
  useEffect(() => {
    document.title = isCapturing ? '🔴 DJ LIVE — HearMeOut' : '🎵 Share This Tab — HearMeOut DJ';
  }, [isCapturing]);

  const extractVideoId = (trackId: string, trackUrl?: string): string => {
    if (trackUrl) {
      try {
        const u = new URL(trackUrl);
        return u.searchParams.get('v') || u.pathname.slice(1) || trackId;
      } catch {}
    }
    return trackId;
  };

  const playNext = useCallback(() => {
    const r = roomDataRef.current;
    if (!r?.playlist?.length) return;
    const i = r.playlist.findIndex(t => t.id === r.currentTrackId);
    const next = r.playlist[(i + 1) % r.playlist.length];
    if (next) {
      console.log(`[DJ] Auto-advancing to: ${next.title}`);
      fetch('/api/db', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'rooms', id: roomId, data: { currentTrackId: next.id, isPlaying: true } }),
      }).catch(console.error);
    }
  }, [roomId]);

  // 1. Init YouTube player
  useEffect(() => {
    let cancelled = false;
    loadYTApi().then(() => {
      if (cancelled) return;
      playerRef.current = new window.YT.Player('yt-player', {
        height: '200',
        width: '100%',
        playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => { playerReadyRef.current = true; setYtReady(true); setStatus('Player ready — click "Start Broadcasting"'); },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.ENDED) playNext();
          },
          onError: (e: any) => {
            console.error('[DJ] YouTube error:', e.data);
            setTimeout(playNext, 3000);
          },
        },
      });
    });
    return () => { cancelled = true; };
  }, [playNext]);

  // 2. Start broadcasting — getDisplayMedia + LiveKit
  const startBroadcast = useCallback(async () => {
    try {
      setStatus('Requesting tab audio capture...');

      // getDisplayMedia — browser prompts user to share this tab's audio
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true, // Chrome requires video for getDisplayMedia, we ignore it
      } as any);

      // Stop video tracks immediately — we only want audio
      stream.getVideoTracks().forEach(t => t.stop());

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        setStatus('ERROR: No audio captured. Make sure you selected "Share tab audio"');
        return;
      }

      captureStreamRef.current = stream;
      console.log('[DJ] Tab audio captured');
      setStatus('Connecting to LiveKit...');

      // Connect to LiveKit music room
      const tokenRes = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId: 'HearMeOutDJ', userName: 'HearMeOut DJ', musicRoom: true, isDJ: true }),
      });
      const { token } = await tokenRes.json();

      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl || !token) { setStatus('ERROR: Missing LiveKit config'); return; }

      const lkRoom = new Room();
      await lkRoom.connect(livekitUrl, token);
      livekitRoomRef.current = lkRoom;
      console.log('[DJ] Connected as', lkRoom.localParticipant.identity);

      // Publish captured audio to LiveKit
      const localTrack = new LocalAudioTrack(audioTrack, undefined, false);
      await lkRoom.localParticipant.publishTrack(localTrack, {
        name: 'music',
        source: Track.Source.ScreenShareAudio,
      });
      publishedTrackRef.current = localTrack;

      // Handle user stopping the share
      audioTrack.onended = () => {
        console.log('[DJ] Tab sharing stopped');
        stopBroadcast();
      };

      setIsCapturing(true);
      setStatus('🔴 BROADCASTING — Everyone can hear the music');
      console.log('[DJ] Broadcasting started');

      // Mark DJ active
      fetch('/api/db', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'rooms', id: roomId, data: { djActive: true } }),
      }).catch(() => {});

    } catch (err: any) {
      console.error('[DJ] Broadcast error:', err);
      setStatus(`ERROR: ${err.message}`);
    }
  }, [roomId]);

  const stopBroadcast = useCallback(() => {
    publishedTrackRef.current?.stop();
    publishedTrackRef.current = null;
    captureStreamRef.current?.getTracks().forEach(t => t.stop());
    captureStreamRef.current = null;
    livekitRoomRef.current?.disconnect();
    livekitRoomRef.current = null;
    setIsCapturing(false);
    setStatus('Broadcast stopped');

    fetch('/api/db', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'rooms', id: roomId, data: { djActive: false } }),
    }).catch(() => {});
  }, [roomId]);

  // 3. Poll room state and control YouTube player
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/db?collection=rooms&id=${roomId}`);
        const result = await res.json();
        if (!result.exists) return;

        const data = result.data as RoomData;
        roomDataRef.current = data;

        if (!playerReadyRef.current || !ytReady) return;

        const { currentTrackId, isPlaying, playlist } = data;

        if (!currentTrackId || !isPlaying) {
          try { playerRef.current?.pauseVideo(); } catch {}
          setCurrentTrack('');
          return;
        }

        const track = playlist?.find(t => t.id === currentTrackId);
        const videoId = extractVideoId(currentTrackId, track?.url);

        if (lastTrackRef.current !== currentTrackId) {
          lastTrackRef.current = currentTrackId;
          setCurrentTrack(track?.title || videoId);
          console.log(`[DJ] Loading: ${track?.title || videoId}`);
          playerRef.current?.loadVideoById(videoId);
        } else if (isPlaying) {
          const state = playerRef.current?.getPlayerState?.();
          if (state === window.YT?.PlayerState?.PAUSED) {
            playerRef.current?.playVideo();
          }
        }

        if (!isPlaying) {
          try { playerRef.current?.pauseVideo(); } catch {}
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [roomId, ytReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      publishedTrackRef.current?.stop();
      captureStreamRef.current?.getTracks().forEach(t => t.stop());
      livekitRoomRef.current?.disconnect();
      fetch('/api/db', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'rooms', id: roomId, data: { djActive: false } }),
      }).catch(() => {});
    };
  }, [roomId]);

  return (
    <div style={{ background: '#111', color: '#fff', fontFamily: 'system-ui', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>🎵 HearMeOut DJ</h2>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 4,
          background: isCapturing ? '#dc2626' : '#333',
          color: isCapturing ? '#fff' : '#999',
        }}>
          {isCapturing ? '🔴 LIVE' : 'OFF AIR'}
        </span>
      </div>

      {/* Big instruction banner when not broadcasting */}
      {!isCapturing && (
        <div style={{
          background: '#7c3aed', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'center',
        }}>
          <p style={{ fontSize: 18, fontWeight: 'bold', margin: '0 0 8px' }}>📡 Share THIS Tab</p>
          <p style={{ fontSize: 13, color: '#e0d4ff', margin: 0, lineHeight: 1.5 }}>
            Click the button below → Chrome will ask what to share →<br/>
            Pick <strong>"This Tab"</strong> and check <strong>"Share tab audio"</strong>
          </p>
        </div>
      )}

      {/* Status */}
      <p style={{ fontSize: 12, color: status.includes('ERROR') ? '#f87171' : status.includes('BROADCASTING') ? '#4ade80' : '#999', margin: '0 0 12px' }}>
        {status}
      </p>

      {/* Broadcast button */}
      {!isCapturing ? (
        <button
          onClick={startBroadcast}
          disabled={!ytReady}
          style={{
            width: '100%', padding: '14px', marginBottom: 12, border: 'none', borderRadius: 6,
            background: ytReady ? '#16a34a' : '#333', color: '#fff', fontSize: 16, fontWeight: 'bold',
            cursor: ytReady ? 'pointer' : 'default',
          }}
        >
          {ytReady ? '📡 Start Broadcasting' : '⏳ Loading player...'}
        </button>
      ) : (
        <button
          onClick={stopBroadcast}
          style={{
            width: '100%', padding: '14px', marginBottom: 12, border: 'none', borderRadius: 6,
            background: '#dc2626', color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
          }}
        >
          ⏹ Stop Broadcasting
        </button>
      )}

      {/* Now playing */}
      {currentTrack && (
        <p style={{ fontSize: 13, color: '#a78bfa', margin: '0 0 12px' }}>
          🎵 Now Playing: {currentTrack}
        </p>
      )}

      {/* YouTube Player — wrapper div so YT API doesn't conflict with React */}
      <div style={{ borderRadius: 6, overflow: 'hidden' }}>
        <div id="yt-player-container" ref={(el) => {
          if (el && !document.getElementById('yt-player')) {
            const div = document.createElement('div');
            div.id = 'yt-player';
            el.appendChild(div);
          }
        }} />
      </div>

      {/* Step by step when not broadcasting */}
      {!isCapturing && (
        <div style={{ marginTop: 16, background: '#1a1a2e', borderRadius: 8, padding: 14, fontSize: 13, color: '#888', lineHeight: 1.8 }}>
          <p style={{ color: '#fff', fontWeight: 'bold', margin: '0 0 6px' }}>How it works:</p>
          <p style={{ margin: 0 }}>1️⃣ Click <strong style={{ color: '#4ade80' }}>Start Broadcasting</strong> above</p>
          <p style={{ margin: 0 }}>2️⃣ Chrome asks what to share — pick <strong style={{ color: '#a78bfa' }}>This Tab</strong></p>
          <p style={{ margin: 0 }}>3️⃣ Check the <strong style={{ color: '#a78bfa' }}>"Also share tab audio"</strong> box</p>
          <p style={{ margin: 0 }}>4️⃣ Click Share — music plays here, everyone hears it!</p>
          <p style={{ margin: '8px 0 0', color: '#666', fontSize: 11 }}>Keep this tab open while DJing. Close it to stop.</p>
        </div>
      )}

      {/* Minimal info when broadcasting */}
      {isCapturing && (
        <p style={{ marginTop: 12, fontSize: 11, color: '#4ade80', textAlign: 'center' }}>
          ✅ Broadcasting to room — everyone can hear the music
        </p>
      )}
    </div>
  );
}
