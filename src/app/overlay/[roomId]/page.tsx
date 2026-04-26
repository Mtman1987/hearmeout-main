'use client';

// OBS Overlay — shows now-playing info AND plays the music audio for OBS to capture.
// Subscribes to the same LiveKit music room the regular /rooms/[roomId] page subscribes to,
// so streamers can put this URL in an OBS browser source and capture both visuals + audio
// without needing a separate audio source.

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useDoc } from '@/hooks/use-db';
import { Music } from 'lucide-react';
import Image from 'next/image';
import { Room as LKRoom, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { generateMusicRoomToken } from '@/app/actions';
import type { PlaylistItem } from '@/types/playlist';

interface RoomData {
  name: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
  djActive: boolean;
}

function genOverlayId() {
  return `overlay-${Math.random().toString(36).slice(2, 10)}`;
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { data: room, isLoading } = useDoc<RoomData>('rooms', roomId, 2000);

  const musicRoomRef = useRef<LKRoom | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'connecting' | 'connected' | 'streaming' | 'error' | 'autoplay-blocked'>('idle');

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const overlayId = genOverlayId();

    const connect = async () => {
      try {
        setAudioStatus('connecting');
        const token = await generateMusicRoomToken(roomId, overlayId, 'OBS Overlay', false);
        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (!livekitUrl || cancelled) return;

        const lkRoom = new LKRoom();
        await lkRoom.connect(livekitUrl, token);
        if (cancelled) {
          lkRoom.disconnect();
          return;
        }
        musicRoomRef.current = lkRoom;
        setAudioStatus('connected');
        console.log('[Overlay] Connected to music room', { participants: lkRoom.remoteParticipants.size });

        const attachTrack = (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return;
          if (!audioElRef.current) {
            audioElRef.current = new Audio();
            audioElRef.current.autoplay = true;
          }
          track.attach(audioElRef.current);
          audioElRef.current.play()
            .then(() => setAudioStatus('streaming'))
            .catch((err) => {
              console.warn('[Overlay] autoplay blocked:', err);
              setAudioStatus('autoplay-blocked');
            });
        };

        lkRoom.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track && pub.isSubscribed) attachTrack(pub.track as RemoteTrack);
          });
        });

        lkRoom.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track as RemoteTrack));
        lkRoom.on(RoomEvent.TrackUnsubscribed, () => {
          if (audioElRef.current) audioElRef.current.srcObject = null;
          setAudioStatus('connected');
        });
      } catch (err) {
        console.error('[Overlay] connect error:', err);
        setAudioStatus('error');
      }
    };

    connect();
    return () => {
      cancelled = true;
      musicRoomRef.current?.disconnect();
      musicRoomRef.current = null;
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
        audioElRef.current = null;
      }
    };
  }, [roomId]);

  // Manual unblock for autoplay-blocked browsers (OBS browser source allows autoplay,
  // but a real Chrome tab opened by hand needs a click first).
  const handleManualPlay = () => {
    audioElRef.current?.play()
      .then(() => setAudioStatus('streaming'))
      .catch(() => {});
  };

  if (isLoading) return <div className="min-h-screen bg-transparent" />;
  if (!room) return <div className="min-h-screen bg-transparent" />;

  const track = room.playlist?.find((t) => t.id === room.currentTrackId);

  return (
    <div className="min-h-screen bg-transparent text-white relative">
      {audioStatus === 'autoplay-blocked' && (
        <button
          type="button"
          onClick={handleManualPlay}
          style={{ position: 'absolute', top: 20, left: 20 }}
          className="rounded-md bg-red-600/90 px-4 py-2 text-sm font-semibold shadow-lg"
        >
          Click to enable audio
        </button>
      )}
      {track && room.isPlaying && (
        <div style={{ position: 'absolute', left: 20, bottom: 20 }}>
          <div className="rounded-lg bg-black/80 backdrop-blur-md p-4 shadow-2xl min-w-[300px] flex items-center gap-4">
            {track.thumbnail ? (
              <Image src={track.thumbnail} alt="" width={64} height={64} className="rounded-md" unoptimized />
            ) : (
              <div className="w-16 h-16 bg-white/10 rounded-md flex items-center justify-center">
                <Music className="w-8 h-8 text-white/80" />
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <h2 className="text-lg font-bold truncate">{track.title}</h2>
              <p className="text-sm text-gray-400 truncate">{track.artist}</p>
            </div>
            {room.djActive && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />}
          </div>
        </div>
      )}
    </div>
  );
}
