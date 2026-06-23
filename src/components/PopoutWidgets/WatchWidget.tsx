'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Film, Music, Play, SkipForward, Trash2, Search, ExternalLink, LoaderCircle } from 'lucide-react';
import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

interface WatchWidgetProps {
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
  sessionScope?: 'discord' | 'overlay';
  canControl?: boolean;
}

type WatchState = {
  id: string;
  roomUrl: string;
  queue: Array<{
    requestId: string;
    requestedBy: { userId: string; username: string };
    addedAt: string;
    item: { id: string; type: string; title: string; year: number; runtime: string; source: string; poster: string; playbackUrl: string; overview: string };
  }>;
  current: {
    requestId: string;
    requestedBy: { userId: string; username: string };
    addedAt: string;
    item: { id: string; type: string; title: string; year: number; runtime: string; source: string; poster: string; playbackUrl: string; overview: string };
  } | null;
  playback: { status: 'idle' | 'paused' | 'playing'; position: number; updatedAt: number };
  events: Array<{ id: string; at: string; message: string }>;
};

function watchRequestErrorMessage(data: any) {
  if (data?.discovery) {
    const title = data.discovery.title || 'that title';
    const year = data.discovery.year ? ` (${data.discovery.year})` : '';
    return `Found "${title}"${year} in Watchmode, but it is metadata only. Add a provider stream for it or try a playable test title.`;
  }

  if (data?.recommendation) {
    const title = data.recommendation.title || 'a possible Internet Archive match';
    return `No provider stream matched. Internet Archive found "${title}"; type !add in Discord to accept it.`;
  }

  return data?.error || 'No match found';
}

export function WatchWidget({
  id, position, size, opacity,
  onPositionChange, onSizeChange, onOpacityChange, onSaveLayout, onClose, roomId,
  sessionScope = 'discord',
  canControl = false,
}: WatchWidgetProps) {
  const [state, setState] = useState<WatchState | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'movie' | 'music'>('movie');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const movieSessionId = GLOBAL_WATCH_SESSION_ID;
  const musicSessionId = MUSIC_WATCH_SESSION_ID;
  const sessionId = tab === 'music' ? musicSessionId : movieSessionId;

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(`/api/watch/sessions/${sessionId}/state`, { cache: 'no-store' });
      if (res.ok) setState(await res.json());
    } catch {}
  }, [roomId, sessionId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId) {
      setError('Room is still loading. Close and reopen Watch Party if this persists.');
      return;
    }
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/watch/sessions/${sessionId}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), username: 'local viewer', mediaType: tab === 'music' ? 'music' : 'video' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(watchRequestErrorMessage(data));
      } else {
        setState(data.session);
        setQuery('');
      }
    } catch {
      setError('Request failed');
    } finally {
      setSearching(false);
    }
  };

  const handleControl = async (action: string) => {
    try {
      const res = await fetch(`/api/watch/sessions/${sessionId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, position: 0 }),
      });
      if (res.ok) setState(await res.json());
    } catch {}
  };

  const watchRoomUrl = `${state?.roomUrl || `/watch/${sessionId}`}${(state?.roomUrl || `/watch/${sessionId}`).includes('?') ? '&' : '?'}canPause=${canControl ? '1' : '0'}`;
  const overlayUrl = `/overlay/${encodeURIComponent(roomId)}?media=${tab === 'music' ? 'music' : 'movie'}`;
  const discordActivityUrl = state?.roomUrl
    ? `https://discord.com/activities?url=${encodeURIComponent(state.roomUrl)}`
    : null;

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
      title="Watch Party"
      minimalChrome
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={tab === 'movie' ? 'secondary' : 'outline'} size="sm" onClick={() => { setTab('movie'); setError(null); }}>
            <Film className="mr-1 h-3.5 w-3.5" /> Movies
          </Button>
          <Button type="button" variant={tab === 'music' ? 'secondary' : 'outline'} size="sm" onClick={() => { setTab('music'); setError(null); }}>
            <Music className="mr-1 h-3.5 w-3.5" /> Music
          </Button>
        </div>

        {state?.current ? (
          <div className="space-y-2">
            {sessionScope === 'overlay' ? (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-black p-3 text-center text-xs text-muted-foreground">
                <Music className="h-5 w-5 text-emerald-300" />
                <p>Stream Mode is on. Media output is the overlay browser source.</p>
                <Button variant="outline" size="sm" asChild>
                  <a href={overlayUrl} target="_blank" rel="noreferrer">Open Overlay</a>
                </Button>
              </div>
            ) : (
              <div className="aspect-video w-full rounded-md overflow-hidden border border-border bg-black">
                <iframe
                  src={watchRoomUrl}
                  className="w-full h-full"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{state.current.item.title} ({state.current.item.year})</p>
                <p className="text-xs text-muted-foreground truncate">
                  {state.current.item.source} · by {state.current.requestedBy.username}
                </p>
              </div>
              {canControl && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleControl('play')}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleControl('next')}>
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleControl('clear')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="aspect-video w-full rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
            <Film className="h-5 w-5 mr-2" /> No video loaded — search below
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs" asChild>
            <a href={sessionScope === 'overlay' ? overlayUrl : watchRoomUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> {sessionScope === 'overlay' ? 'Open Overlay' : 'Open Watch Room'}
            </a>
          </Button>
          {discordActivityUrl && (
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => navigator.clipboard.writeText(state!.roomUrl)}>
              Copy Link for Discord
            </Button>
          )}
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder={tab === 'music' ? 'Search song or YouTube URL...' : 'Search movie or TV show...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={searching}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={searching || !query.trim()}>
            {searching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </form>
        {error && <p className="text-xs text-red-400">{error}</p>}

        {state?.queue && state.queue.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">Up Next</p>
            {state.queue.map((entry, i) => (
              <div key={entry.requestId} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
                <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{entry.item.title}</p>
                  <p className="text-xs text-muted-foreground">{entry.requestedBy.username}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DraggableContainer>
  );
}
