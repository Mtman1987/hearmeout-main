'use client';

import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import { getRoomWatchSessionId } from '@/lib/watch-session';

type DraggableWidgetProps = Pick<React.ComponentProps<typeof DraggableContainer>,
  'id' | 'position' | 'size' | 'opacity' | 'onPositionChange' | 'onSizeChange' | 'onOpacityChange' | 'onSaveLayout' | 'onClose'
>;

interface WatchWidgetProps extends DraggableWidgetProps {
  roomId: string;
  sessionScope?: 'discord' | 'overlay';
  canControl?: boolean;
  initialTab?: 'movie' | 'music';
}

export function WatchWidget({
  id, position, size, opacity, onPositionChange, onSizeChange,
  onOpacityChange, onSaveLayout, onClose, roomId, initialTab = 'movie',
}: WatchWidgetProps) {
  return (
    <DraggableContainer id={id} position={position} size={size} opacity={opacity}
      onPositionChange={onPositionChange} onSizeChange={onSizeChange}
      onOpacityChange={onOpacityChange} onSaveLayout={onSaveLayout} onClose={onClose}
      title="HearMeOut" minimalChrome>
      <iframe title="HearMeOut player" src={`/activity?sessionId=${getRoomWatchSessionId(roomId, initialTab)}`}
        className="h-full w-full border-0" allow="autoplay" />
    </DraggableContainer>
  );
}
