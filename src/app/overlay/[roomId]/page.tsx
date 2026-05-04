'use client';

// OBS Overlay — shows now-playing info for stream display AND plays
// music audio via LiveKit WebRTC. Streamers capture this browser source
// in OBS so music audio is on a separate channel from speakers' voices,
// allowing them to strip music for copyright reasons.

import { useParams } from 'next/navigation';
import { useDoc } from '@/hooks/use-db';
import { Music, Volume2, VolumeX } from 'lucide-react';
import Image from 'next/image';
import type { PlaylistItem } from '@/types/playlist';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Room as LKRoom, RoomEvent, Track, RemoteTrack } from 'livekit-client';
import { generateMusicRoomToken } from '@/app/actions';

interface RoomData {
  name: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
  djActive: boolean;
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { data: room, isLoading } = useDoc<RoomData>('rooms', roomId, 2000);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRoomRef = useRef<LKRoom | null>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(isMuted);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  // Sync volume changes to the audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    const unlockOverlayAudio = () => {
      const audio = audioRef.current;
      if (!audio || !audio.srcObject) return;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      void audio.play().catch(() => {});
    };
    window.addEventListener('pointerdown', unlockOverlayAudio, { passive: true });
    window.addEventListener('keydown', unlockOverlayAudio);
    window.addEventListener('touchstart', unlockOverlayAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOverlayAudio);
      window.removeEventListener('keydown', unlockOverlayAudio);
      window.removeEventListener('touchstart', unlockOverlayAudio);
    };
  }, []);

  // Connect to LiveKit Music Room and play audio through this overlay.
  // When used as an OBS browser source, this makes the music audio
  // capturable on a separate channel from speakers.
  const connectToMusicRoom = useCallback(async () => {
    if (musicRoomRef.current || !roomId) return;

    try {
      const token = await generateMusicRoomToken(roomId, `overlay-${roomId}`, 'Overlay', false);
      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl || !token) return;

      const lkRoom = new LKRoom();
      await lkRoom.connect(livekitUrl, token);
      musicRoomRef.current = lkRoom;
      console.log('[Overlay] Connected to music room');

      const attachTrack = (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          console.log('[Overlay] Audio track received — attaching');
          if (!audioRef.current) audioRef.current = new Audio();
          track.attach(audioRef.current);
          audioRef.current.volume = mutedRef.current ? 0 : volumeRef.current;
          audioRef.current.play().catch(e => console.warn('[Overlay] Autoplay blocked:', e));
        }
      };

      lkRoom.remoteParticipants.forEach(p => {
        p.trackPublications.forEach(pub => {
          if (pub.track && pub.isSubscribed) attachTrack(pub.track as RemoteTrack);
        });
      });

      lkRoom.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
      lkRoom.on(RoomEvent.TrackUnsubscribed, () => {
        if (audioRef.current) audioRef.current.srcObject = null;
      });
    } catch (err) {
      console.error('[Overlay] Music room error:', err);
    }
  }, [roomId]);

  useEffect(() => {
    connectToMusicRoom();
    return () => {
      musicRoomRef.current?.disconnect();
      musicRoomRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
    };
  }, [connectToMusicRoom]);

  if (isLoading) return <div className="min-h-screen bg-transparent" />;
  if (!room) return <div className="min-h-screen bg-transparent" />;

  const track = room.playlist?.find(t => t.id === room.currentTrackId);

  if (!track || !room.isPlaying) return <div className="min-h-screen bg-transparent" />;

  return (
    <div className="min-h-screen bg-transparent text-white relative">
      {/* Now Playing — bottom left, designed for OBS browser source */}
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

      {/* Volume Controls — top right, only visible when hovering (for streamer monitoring) */}
      <div style={{ position: 'absolute', right: 20, top: 20 }} className="opacity-0 hover:opacity-100 transition-opacity">
        <div className="rounded-lg bg-black/80 backdrop-blur-md p-3 shadow-2xl flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{isMuted ? 'Unmute' : 'Mute'} monitor</p></TooltipContent>
          </Tooltip>
          <Slider
            value={[isMuted ? 0 : volume]}
            onValueChange={(v) => {
              setVolume(v[0]);
              if (isMuted) setIsMuted(false);
            }}
            max={1}
            step={0.05}
            className="w-24"
          />
        </div>
      </div>
    </div>
  );
}
