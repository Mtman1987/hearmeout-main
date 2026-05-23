'use client';

import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import AddMusicPanel from '@/app/rooms/[roomId]/_components/AddMusicPanel';
import { useDoc } from '@/hooks/use-db';
import { dbUpdateStrict } from '@/lib/db-helpers';
import type { PlaylistItem } from '@/types/playlist';

interface AddSongWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity?: number;
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onOpacityChange?: (opacity: number) => void;
  onSaveLayout?: () => void;
  onClose: () => void;
  roomId: string;
}

interface RoomData {
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
}

export function AddSongWidget({
  id,
  position,
  size,
  opacity,
  onPositionChange,
  onSizeChange,
  onOpacityChange,
  onSaveLayout,
  onClose,
  roomId,
}: AddSongWidgetProps) {
  const { data: room } = useDoc<RoomData>('rooms', roomId, 2000);

  const handleAddItems = React.useCallback(async (items: PlaylistItem[]) => {
    const current = room?.playlist || [];
    const newPlaylist = [...current, ...items];
    const updates: Record<string, unknown> = { playlist: newPlaylist };
    if ((!room?.isPlaying || !room.currentTrackId) && items.length > 0) {
      updates.currentTrackId = items[0].id;
      updates.isPlaying = true;
    }
    await dbUpdateStrict('rooms', roomId, updates);
  }, [room, roomId]);

  return (
    <DraggableContainer
      id={id}
      position={position}
      size={size}
      opacity={opacity}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onOpacityChange={onOpacityChange}
      onSaveLayout={onSaveLayout}
      onClose={onClose}
      title="Add Song"
      minimalChrome
    >
      <div className="h-full overflow-y-auto p-3">
        <AddMusicPanel onAddItems={handleAddItems} onClose={onClose} canAddMusic={true} />
      </div>
    </DraggableContainer>
  );
}
