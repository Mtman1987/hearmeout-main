'use client';

import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import AddMusicPanel from '@/app/rooms/[roomId]/_components/AddMusicPanel';
import { getRoomWatchSessionId, isActivityRoomId } from '@/lib/watch-session';
import type { PlaylistItem } from '@/types/playlist';

type DraggableWidgetProps = Pick<React.ComponentProps<typeof DraggableContainer>,
  'id' | 'position' | 'size' | 'opacity' | 'onPositionChange' | 'onSizeChange' | 'onOpacityChange' | 'onSaveLayout' | 'onClose'
>;

interface AddSongWidgetProps extends DraggableWidgetProps {
  onClose: () => void;
  roomId: string;
  sessionScope?: 'discord' | 'overlay';
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
  const sessionId = getRoomWatchSessionId(roomId, 'music');
  const handleAddItems = React.useCallback(async (items: PlaylistItem[]) => {
    for (const item of items) {
      const query = item.url || [item.title, item.artist].filter(Boolean).join(' ');
      const res = await fetch(`/api/watch/sessions/${encodeURIComponent(sessionId)}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          username: item.addedBy || 'local viewer',
          mediaType: 'music',
          platform: item.source || 'web',
          roomId,
          announceDiscord: isActivityRoomId(roomId),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Could not add "${item.title}" to Music Videos.`);
      }
    }
  }, [roomId, sessionId]);

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
