'use client';

import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import PlaylistPanel from '@/app/rooms/[roomId]/_components/PlaylistPanel';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useDoc } from '@/hooks/use-db';
import { useSession } from '@/hooks/use-session';
import { dbUpdate } from '@/lib/db-helpers';
import type { PlaylistItem } from '@/types/playlist';

interface QueueWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity?: number;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onOpacityChange?: (opacity: number) => void;
  onClose: () => void;
  roomId: string;
  onOpenAddSong?: () => void;
}

interface RoomData {
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
}

export function QueueWidget({
  id,
  position,
  size,
  opacity,
  onPositionChange,
  onSizeChange,
  onOpacityChange,
  onClose,
  roomId,
  onOpenAddSong,
}: QueueWidgetProps) {
  const { user } = useSession();
  const { data: room } = useDoc<RoomData>('rooms', roomId, 2000);
  const playlist = room?.playlist || [];
  const canControl = !!user;

  const handlePlaySong = React.useCallback((songId: string) => {
    if (canControl) dbUpdate('rooms', roomId, { currentTrackId: songId, isPlaying: true });
  }, [canControl, roomId]);

  const handleRemoveSong = React.useCallback((songId: string) => {
    dbUpdate('rooms', roomId, { playlist: playlist.filter((song) => song.id !== songId) });
  }, [playlist, roomId]);

  const handleClearPlaylist = React.useCallback(() => {
    dbUpdate('rooms', roomId, { playlist: [], currentTrackId: '', isPlaying: false });
  }, [roomId]);

  return (
    <DraggableContainer
      id={id}
      position={position}
      size={size}
      opacity={opacity}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onOpacityChange={onOpacityChange}
      onClose={onClose}
      title="Queue"
      minimalChrome
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {canControl && onOpenAddSong && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onOpenAddSong}>
              <Plus className="h-4 w-4 mr-1" /> Add Song
            </Button>
          </div>
        )}
        <PlaylistPanel
          playlist={playlist}
          currentTrackId={room?.currentTrackId || ''}
          isPlayerControlAllowed={canControl}
          onPlaySong={handlePlaySong}
          onRemoveSong={handleRemoveSong}
          onClearPlaylist={handleClearPlaylist}
        />
      </div>
    </DraggableContainer>
  );
}
