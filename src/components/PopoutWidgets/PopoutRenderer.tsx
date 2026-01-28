'use client';

import React from 'react';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { VoiceRoomWidget } from '@/components/PopoutWidgets/VoiceRoomWidget';
import { ChatWidget } from '@/components/PopoutWidgets/ChatWidget';

/**
 * PopoutRenderer - Renders all active popout widgets
 * This component should be placed in the root layout to ensure
 * popouts are rendered at the top level of the DOM
 */
export function PopoutRenderer() {
  const { popouts, closePopout, updatePopout } = usePopout();
  const [roomId, setRoomId] = React.useState<string>('');

  // Get roomId from current route if possible
  React.useEffect(() => {
    const pathParts = typeof window !== 'undefined' ? window.location.pathname.split('/') : [];
    const roomIndex = pathParts.indexOf('rooms');
    if (roomIndex !== -1 && pathParts[roomIndex + 1]) {
      setRoomId(pathParts[roomIndex + 1]);
    }
  }, []);

  return (
    <>
      {popouts.map((popout) => {
        if (popout.type === 'voice') {
          return (
            <VoiceRoomWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
              onClose={() => closePopout(popout.id)}
            />
          );
        }

        if (popout.type === 'chat') {
          return (
            <ChatWidget
              key={popout.id}
              id={popout.id}
              position={popout.position}
              size={popout.size}
              onPositionChange={(pos) => updatePopout(popout.id, { position: pos })}
              onSizeChange={(size) => updatePopout(popout.id, { size })}
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
