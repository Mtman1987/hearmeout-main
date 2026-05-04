'use client';

import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import PlaylistPanel from '@/app/rooms/[roomId]/_components/PlaylistPanel';
import AddMusicPanel from '@/app/rooms/[roomId]/_components/AddMusicPanel';
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

  const handleAddItems = React.useCallback((items: PlaylistItem[]) => {
    if (!canControl) return;
    const newPlaylist = [...playlist, ...items];
    const updates: Record<string, unknown> = { playlist: newPlaylist };
    if ((!room?.isPlaying || !room.currentTrackId) && items.length > 0) {
      updates.currentTrackId = items[0].id;
      updates.isPlaying = true;
    }
    dbUpdate('rooms', roomId, updates);
  }, [canControl, playlist, room, roomId]);

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
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <PlaylistPanel
          playlist={playlist}
          currentTrackId={room?.currentTrackId || ''}
          isPlayerControlAllowed={canControl}
          onPlaySong={handlePlaySong}
          onRemoveSong={handleRemoveSong}
          onClearPlaylist={handleClearPlaylist}
        />
        {canControl && <AddMusicPanel onAddItems={handleAddItems} onClose={onClose} canAddMusic={true} />}
      </div>
    </DraggableContainer>
  );
}
