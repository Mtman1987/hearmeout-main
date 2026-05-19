'use client';

import React from 'react';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { ChatWidget } from '@/components/PopoutWidgets/ChatWidget';
import { QueueWidget } from '@/components/PopoutWidgets/QueueWidget';
import { AddSongWidget } from '@/components/PopoutWidgets/AddSongWidget';
import { WatchWidget } from '@/components/PopoutWidgets/WatchWidget';
import { ScreenShareWidget } from '@/components/PopoutWidgets/ScreenShareWidget';

export function PopoutRenderer() {
  const { popouts, closePopout, updatePopout, openPopout } = usePopout();
  const [roomId, setRoomId] = React.useState<string>('');

  React.useEffect(() => {
    const pathParts = typeof window !== 'undefined' ? window.location.pathname.split('/') : [];
    const roomIndex = pathParts.indexOf('rooms');
    const overlayIndex = pathParts.indexOf('overlay');
    if (roomIndex !== -1 && pathParts[roomIndex + 1]) setRoomId(pathParts[roomIndex + 1]);
    else if (overlayIndex !== -1 && pathParts[overlayIndex + 1]) setRoomId(pathParts[overlayIndex + 1]);
  }, []);

  return (
    <>
      {popouts.map((popout) => {
        if (popout.type === 'chat') {
          return (
            <ChatWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              opacity={popout.opacity}
              onOpacityChange={(opacity) => updatePopout(popout.id, { opacity })}
              onClose={() => closePopout(popout.id)}
              roomId={roomId}
              source={popout.customSettings?.source}
            />
          );
        }
        if (popout.type === 'queue') {
          return (
            <QueueWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              opacity={popout.opacity}
              onOpacityChange={(opacity) => updatePopout(popout.id, { opacity })}
              onClose={() => closePopout(popout.id)}
              roomId={roomId}
              onOpenAddSong={() => openPopout('addSong', { width: 460, height: 560 }, { source: 'addSong' })}
            />
          );
        }
        if (popout.type === 'addSong') {
          return (
            <AddSongWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              opacity={popout.opacity}
              onOpacityChange={(opacity) => updatePopout(popout.id, { opacity })}
              onClose={() => closePopout(popout.id)}
              roomId={roomId}
            />
          );
        }
        if (popout.type === 'watch') {
          return (
            <WatchWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              opacity={popout.opacity}
              onOpacityChange={(opacity) => updatePopout(popout.id, { opacity })}
              onClose={() => closePopout(popout.id)}
              roomId={roomId}
            />
          );
        }
        if (popout.type === 'screenShare') {
          return (
            <ScreenShareWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              opacity={popout.opacity}
              onOpacityChange={(opacity) => updatePopout(popout.id, { opacity })}
              onClose={() => closePopout(popout.id)}
              roomId={roomId}
            />
          );
        }
        return null;
      })}
    </>
  );
}
