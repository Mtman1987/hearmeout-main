import React, { useState, useEffect, useRef } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { Button } from '@/components/ui/button';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { useToast } from '@/hooks/use-toast';

interface ChatWidgetProps {
  id: string; position: { x: number; y: number }; size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void; onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void; roomId: string;
}

export function ChatWidget({ id, position, size, onPositionChange, onSizeChange, onClose, roomId }: ChatWidgetProps) {
  const { user } = useSession();
  const { toast } = useToast();
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
    const url = `${DSH_URL}/headless/forwarding?serverId=${serverId}`;
    window.open(url, '_blank');
  };

  if (!user) {
    return <DraggableContainer id={id} position={position} size={size} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title="💬 Chat">
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
    </DraggableContainer>;
  }

  const DSH_URL = 'https://discord-stream-hub-new.fly.dev';

  const iframeUrl = `${DSH_URL}/headless/forwarding?serverId=${serverId}`;

  return (
    <DraggableContainer id={id} position={position} size={size} onPositionChange={onPositionChange} onSizeChange={onSizeChange} onClose={onClose} title="💬 Chat">
      <div className="flex flex-col overflow-hidden flex-1">
        <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
          <Button size="sm" onClick={refreshChat} className="h-8 text-xs" title="Refresh Chat">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" onClick={openInNewTab} className="h-8 text-xs" title="Open in New Tab">
            <ExternalLink className="h-3 w-3" />
          </Button>
          <div className="text-xs text-muted-foreground ml-auto">
            Server: {serverId.slice(-4)}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            ref={iframeRef}
            src={iframeUrl}
            className="w-full h-full border-0"
            title="Chat Feed"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </DraggableContainer>
  );
}
