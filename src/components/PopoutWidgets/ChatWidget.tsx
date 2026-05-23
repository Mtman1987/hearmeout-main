import React, { useState, useEffect, useRef } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import ChatBox from '@/app/rooms/[roomId]/_components/ChatBox';
import { DSH_URL } from '@/lib/constants';

interface ChatWidgetProps {
  id: string; position: { x: number; y: number }; size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void; onSizeChange: (size: { width: number; height: number }) => void;
  opacity?: number; onOpacityChange?: (opacity: number) => void;
  onSaveLayout?: () => void; onClose: () => void; roomId: string; source?: 'space' | 'twitch' | 'discord';
}

export function ChatWidget({ id, position, size, onPositionChange, onSizeChange, opacity, onOpacityChange, onSaveLayout, onClose, roomId, source = 'discord' }: ChatWidgetProps) {
  const { user } = useSession();
  const [serverId, setServerId] = useState('1240832965865635881');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: firestoreUser } = useDoc<{ discordGuildId?: string; twitchChannel?: string; discordSelectedChannel?: string }>(
    user ? `rooms/${roomId}/users` : null, user?.uid || null
  );

  useEffect(() => {
    if (firestoreUser?.discordGuildId) {
      setServerId(firestoreUser.discordGuildId);
    }
  }, [firestoreUser]);

  if (!user) {
    return <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onSaveLayout={onSaveLayout} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title="Chat">
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
    </DraggableContainer>;
  }

  const title = source === 'space' ? 'Space Mountain Chat' : source === 'twitch' ? 'Twitch Chat' : 'Discord Chat';

  if (source === 'space') {
    return (
      <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onSaveLayout={onSaveLayout} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title={title} minimalChrome>
        <ChatBox compact />
      </DraggableContainer>
    );
  }

  const channelId = firestoreUser?.discordSelectedChannel?.trim();
  const twitchChannel = firestoreUser?.twitchChannel?.trim().toLowerCase();
  const iframeUrl = source === 'discord'
    ? `${DSH_URL}/headless/forwarding?embed=1&mode=discord&serverId=${encodeURIComponent(serverId)}${channelId ? `&discordChannelId=${encodeURIComponent(channelId)}` : ''}`
    : `${DSH_URL}/headless/forwarding?embed=1&mode=twitch&serverId=${encodeURIComponent(serverId)}${twitchChannel ? `&twitchChannel=${encodeURIComponent(twitchChannel)}` : ''}`;

  return (
    <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onSaveLayout={onSaveLayout} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title={title} minimalChrome>
      {source === 'twitch' && !twitchChannel ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
          Set a Twitch channel from your user card first.
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          className="w-full h-full border-0"
          title="Chat Feed"
          allow="clipboard-read; clipboard-write; autoplay; fullscreen"
        />
      )}
    </DraggableContainer>
  );
}
