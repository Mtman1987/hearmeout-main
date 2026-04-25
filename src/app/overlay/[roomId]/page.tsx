'use client';

// OBS Overlay — shows now-playing info for stream display
// Music playback is handled by the server-side DJ bot, not this page

import { useParams } from 'next/navigation';
import { useDoc } from '@/hooks/use-db';
import { Music, LoaderCircle } from 'lucide-react';
import Image from 'next/image';
import type { PlaylistItem } from '@/types/playlist';

interface RoomData {
  name: string;
  playlist: PlaylistItem[];
  currentTrackId: string;
  isPlaying: boolean;
  djActive: boolean;
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const { data: room, isLoading } = useDoc<RoomData>('rooms', params.roomId, 2000);

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
    </div>
  );
}
