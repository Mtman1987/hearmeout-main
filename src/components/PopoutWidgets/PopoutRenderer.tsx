'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { ChatWidget } from '@/components/PopoutWidgets/ChatWidget';
import { QueueWidget } from '@/components/PopoutWidgets/QueueWidget';
import { AddSongWidget } from '@/components/PopoutWidgets/AddSongWidget';
import { WatchWidget } from '@/components/PopoutWidgets/WatchWidget';
import { ScreenShareWidget } from '@/components/PopoutWidgets/ScreenShareWidget';

function getRoomIdFromPath(pathname: string): string {
  const pathParts = pathname.split('/').filter(Boolean);
  const roomIndex = pathParts.indexOf('rooms');
  const overlayIndex = pathParts.indexOf('overlay');
  if (roomIndex !== -1 && pathParts[roomIndex + 1]) return pathParts[roomIndex + 1];
  if (overlayIndex !== -1 && pathParts[overlayIndex + 1]) return pathParts[overlayIndex + 1];
  return '';
}

export function PopoutRenderer() {
  const { popouts, closePopout, updatePopout, savePopoutLayout, openPopout } = usePopout();
  const pathname = usePathname() || '';
  const roomId = getRoomIdFromPath(pathname);

  return (
    <>
      {popouts.map((popout) => {
        const widgetRoomId = String(popout.customSettings?.roomId || roomId || '');
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
              onSaveLayout={() => savePopoutLayout(popout.id)}
              onClose={() => closePopout(popout.id)}
              roomId={widgetRoomId}
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
              onSaveLayout={() => savePopoutLayout(popout.id)}
              onClose={() => closePopout(popout.id)}
              roomId={widgetRoomId}
              onOpenAddSong={() => openPopout('addSong', { width: 460, height: 560 }, { source: 'addSong', roomId: widgetRoomId })}
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
              onSaveLayout={() => savePopoutLayout(popout.id)}
              onClose={() => closePopout(popout.id)}
              roomId={widgetRoomId}
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
              onSaveLayout={() => savePopoutLayout(popout.id)}
              onClose={() => closePopout(popout.id)}
              roomId={widgetRoomId}
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
              onSaveLayout={() => savePopoutLayout(popout.id)}
              onClose={() => closePopout(popout.id)}
              roomId={widgetRoomId}
            />
          );
        }
        return null;
      })}
    </>
  );
}
