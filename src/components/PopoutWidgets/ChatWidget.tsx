import React, { useState, useEffect, useRef } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { DSH_URL } from '@/lib/constants';
import ChatBox from '@/app/rooms/[roomId]/_components/ChatBox';

interface ChatWidgetProps {
  id: string; position: { x: number; y: number }; size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void; onSizeChange: (size: { width: number; height: number }) => void;
  opacity?: number; onOpacityChange?: (opacity: number) => void;
  onClose: () => void; roomId: string; source?: 'space' | 'twitch' | 'discord';
}

export function ChatWidget({ id, position, size, onPositionChange, onSizeChange, opacity, onOpacityChange, onClose, roomId, source = 'discord' }: ChatWidgetProps) {
  const { user } = useSession();
  const [serverId, setServerId] = useState('1240832965865635881');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: firestoreUser } = useDoc<{ discordGuildId?: string; twitchChannel?: string }>(
    user ? `rooms/${roomId}/users` : null, user?.uid || null
  );

  useEffect(() => {
    // Use Discord guild ID as server ID if available
    if (firestoreUser?.discordGuildId) {
      setServerId(firestoreUser.discordGuildId);
    }
  }, [firestoreUser]);

  const refreshChat = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const openInNewTab = () => {
    const url = source === 'twitch'
      ? `https://www.twitch.tv/popout/${encodeURIComponent(firestoreUser?.twitchChannel || '')}/chat?popout=`
      : `${DSH_URL}/forwarding?serverId=${encodeURIComponent(serverId)}&embed=1`;
    window.open(url, '_blank');
  };

  if (!user) {
    return <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title="Chat">
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
    </DraggableContainer>;
  }

  const title = source === 'space' ? 'Space Mountain Chat' : source === 'twitch' ? 'Twitch Chat' : 'Discord Chat';
  const twitchChannel = firestoreUser?.twitchChannel?.trim().toLowerCase();
  const iframeUrl = source === 'twitch' && twitchChannel
    ? `https://www.twitch.tv/embed/${encodeURIComponent(twitchChannel)}/chat?parent=${window.location.hostname}`
    : `${DSH_URL}/forwarding?serverId=${encodeURIComponent(serverId)}&embed=1`;

  if (source === 'space') {
    return (
      <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title={title}>
        <ChatBox compact />
      </DraggableContainer>
    );
  }

  return (
    <DraggableContainer id={id} position={position} size={size} opacity={opacity} onOpacityChange={onOpacityChange} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title={title}>
      <div className="flex flex-col overflow-hidden flex-1">
        <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
          <Button size="sm" onClick={refreshChat} className="h-8 text-xs" title="Refresh Chat">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" onClick={openInNewTab} className="h-8 text-xs" title="Open in New Tab">
            <ExternalLink className="h-3 w-3" />
          </Button>
          <div className="text-xs text-muted-foreground ml-auto">
            {source === 'twitch' ? (twitchChannel || 'No channel') : `Server: ${serverId.slice(-4)}`}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
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
        </div>
      </div>
    </DraggableContainer>
  );
}
