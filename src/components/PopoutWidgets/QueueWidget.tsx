'use client';
import React from 'react';
import { DraggableContainer } from './DraggableContainer';
import { getMusicWatchSessionId } from '@/lib/watch-session';
interface QueueWidgetProps {
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
  onOpenAddSong?: () => void;
}

export function QueueWidget({ id, position, size, opacity, onPositionChange, onSizeChange, onOpacityChange, onSaveLayout, onClose, onOpenAddSong }: QueueWidgetProps) {
  const [queue, setQueue] = React.useState<Array<{requestId: string; item: {title: string}}>>([]);
  const [title, setTitle] = React.useState('Waiting for a request');
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const response = await fetch(`/api/watch/sessions/${getMusicWatchSessionId()}/state`, { cache: 'no-store' }).catch(() => null);
      if (!response?.ok) return;
      const state = await response.json();
      if (!cancelled) { setQueue(state.queue || []); setTitle(state.current?.item.title || 'Waiting for a request'); }
    };
    void refresh(); const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return <DraggableContainer id={id} position={position} size={size} opacity={opacity}
    onPositionChange={onPositionChange} onSizeChange={onSizeChange} onOpacityChange={onOpacityChange}
    onSaveLayout={onSaveLayout} onClose={onClose} title="Music queue" minimalChrome>
    <div className="space-y-3 overflow-auto p-4"><p className="font-semibold">{title}</p>
      <ol className="list-inside list-decimal">{queue.map(request => <li key={request.requestId}>{request.item.title}</li>)}</ol>
      {!queue.length && <p>Queue is empty.</p>}
      {onOpenAddSong && <button onClick={onOpenAddSong}>Request a song</button>}
    </div>
  </DraggableContainer>;
}
