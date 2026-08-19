'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DraggableContainer } from './DraggableContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Film, Music, Play, SkipForward, Trash2, Search, ExternalLink, LoaderCircle } from 'lucide-react';
import { getRoomWatchSessionId, isActivityRoomId } from '@/lib/watch-session';

type DraggableWidgetProps = Pick<React.ComponentProps<typeof DraggableContainer>,
  'id' | 'position' | 'size' | 'opacity' | 'onPositionChange' | 'onSizeChange' | 'onOpacityChange' | 'onSaveLayout' | 'onClose'
>;

interface WatchWidgetProps extends DraggableWidgetProps {
  roomId: string;
  sessionScope?: 'discord' | 'overlay';
  canControl?: boolean;
  initialTab?: 'movie' | 'music';
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

type WatchSearchResult = {
  id: string;
  title: string;
  year: number;
  runtime: string;
  source: string;
  poster?: string;
  overview?: string;
  recommended?: boolean;
  matchReasons?: string[];
  audio?: { multiTrack?: boolean; languages?: string[] };
  quality?: string | null;
  container?: string | null;
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
  initialTab = 'movie',
}: WatchWidgetProps) {
  const [state, setState] = useState<WatchState | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'movie' | 'music'>(initialTab);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<WatchSearchResult[]>([]);
  const [queuingId, setQueuingId] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<any>(null);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const movieSessionId = getRoomWatchSessionId(roomId, 'movie');
  const musicSessionId = getRoomWatchSessionId(roomId, 'music');
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

  const refreshService = useCallback(async () => {
    if (!canControl || !roomId) return;
    const response = await fetch(`/api/watch/service?roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' }).catch(() => null);
    if (response?.ok) setCacheStatus(await response.json().catch(() => null));
  }, [canControl, roomId]);

  useEffect(() => {
    refreshService();
    if (!canControl) return;
    const interval = window.setInterval(refreshService, 5000);
    return () => window.clearInterval(interval);
  }, [canControl, refreshService]);

  const serviceAction = async (action: 'prepare' | 'prune', item?: WatchSearchResult) => {
    setServiceBusy(item?.id || action);
    setError(null);
    try {
      const response = await fetch('/api/watch/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, roomId, sessionId, itemId: item?.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Service control failed');
      setCacheStatus(payload.cache || payload);
    } catch (cause: any) {
      setError(cause?.message || 'Service control failed');
    } finally {
      setServiceBusy(null);
      window.setTimeout(refreshService, 700);
    }
  };

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
      if (tab === 'movie') {
        const response = await fetch(`/api/watch/search?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Search failed');
        setSearchResults(Array.isArray(payload.results) ? payload.results : []);
        if (!payload.results?.length) setError('No playable results found. Try the exact title and year.');
        return;
      }
      const res = await fetch(`/api/watch/sessions/${sessionId}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          username: 'local viewer',
          mediaType: tab === 'music' ? 'music' : 'video',
          roomId,
          announceDiscord: isActivityRoomId(roomId),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(watchRequestErrorMessage(data));
      } else {
        setState(data.session);
        setQuery('');
        setSearchResults([]);
      }
    } catch (cause: any) {
      setError(cause?.message || 'Request failed');
    } finally {
      setSearching(false);
    }
  };

  const queueSearchResult = async (item: WatchSearchResult) => {
    setQueuingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/watch/sessions/${sessionId}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          query: `${item.title} ${item.year || ''}`.trim(),
          username: 'local viewer',
          mediaType: 'video',
          roomId,
          announceDiscord: isActivityRoomId(roomId),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(watchRequestErrorMessage(data));
      setState(data.session);
      setQuery('');
      setSearchResults([]);
    } catch (cause: any) {
      setError(cause?.message || 'Could not queue this result');
    } finally {
      setQueuingId(null);
    }
  };

  const handleControl = async (action: string) => {
    try {
      const res = await fetch(`/api/watch/sessions/${sessionId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, position: 0, roomId, isHost: canControl, isAdmin: canControl }),
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
      title={tab === 'music' ? 'Room Music Videos' : 'Room Watch Party'}
      minimalChrome
    >
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={tab === 'movie' ? 'secondary' : 'outline'} size="sm" onClick={() => { setTab('movie'); setError(null); setSearchResults([]); }}>
            <Film className="mr-1 h-3.5 w-3.5" /> Movies
          </Button>
          <Button type="button" variant={tab === 'music' ? 'secondary' : 'outline'} size="sm" onClick={() => { setTab('music'); setError(null); setSearchResults([]); }}>
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
            <Film className="h-5 w-5 mr-2" /> No room media loaded. Search below.
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

        {tab === 'movie' && searchResults.length > 0 && (
          <div className="space-y-2 rounded-md border border-border bg-background/60 p-2">
            <p className="text-xs text-muted-foreground">Choose the exact provider file. Nothing is queued until you select one.</p>
            {searchResults.map((item) => (
              <div key={item.id} className="flex gap-2 rounded-md border border-border bg-card p-2">
                {item.poster ? <img src={item.poster} alt="" className="h-16 w-11 shrink-0 rounded object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="line-clamp-2 text-sm">{item.title}</strong>
                    {item.recommended ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">Best match</span> : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {item.year || 'Unknown year'} · {item.quality || item.container || item.runtime} · {item.source}
                  </p>
                  {item.audio?.multiTrack ? (
                    <p className="mt-1 text-[11px] text-cyan-300">Multiple audio tracks — language selector available in player</p>
                  ) : null}
                  <Button type="button" size="sm" className="mt-2 h-7" disabled={Boolean(queuingId)} onClick={() => queueSearchResult(item)}>
                    {queuingId === item.id ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Add this version
                  </Button>
                  {canControl && /^xtream-vod-\d+$/.test(item.id) ? (
                    <Button type="button" variant="outline" size="sm" className="ml-2 mt-2 h-7" disabled={Boolean(serviceBusy)} onClick={() => serviceAction('prepare', item)}>
                      {serviceBusy === item.id ? 'Preparing…' : 'Pre-cache'}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {canControl && cacheStatus && (
          <div className="rounded-md border border-border bg-background/60 p-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>
                Media cache {Math.round(Number(cacheStatus.bytes || 0) / 1024 / 1024)} MB / {Math.round(Number(cacheStatus.budgetBytes || 0) / 1024 / 1024)} MB · {cacheStatus.jobs?.length || 0} active
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7" disabled={Boolean(serviceBusy)} onClick={() => serviceAction('prune')}>
                {serviceBusy === 'prune' ? 'Pruning…' : 'Prune LRU'}
              </Button>
            </div>
            <p className="mt-1">{cacheStatus.entries?.length || 0} prepared streams · {cacheStatus.playlistWindow || 'rolling cache'}</p>
          </div>
        )}
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
