'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    Hls?: any;
  }
}

type WatchState = {
  id: string;
  roomUrl: string;
  queue: Array<any>;
  current: any | null;
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
  };
  events: Array<{ id: string; at: string; message: string }>;
};

function watchRequestErrorMessage(payload: any, fallback: string) {
  if (payload?.discovery) {
    const title = payload.discovery.title || 'that title';
    const year = payload.discovery.year ? ` (${payload.discovery.year})` : '';
    return `Found "${title}"${year} in Watchmode, but Watchmode only provides metadata, not a playable stream. Add an Xtream/M3U provider source that has it, or try a public test title.`;
  }

  if (payload?.recommendation) {
    const title = payload.recommendation.title || 'a possible Internet Archive match';
    return `No provider stream matched. Internet Archive found "${title}"; type !add in Discord to accept it, or search a playable provider title.`;
  }

  return fallback;
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(watchRequestErrorMessage(payload, payload?.error || `Request failed: ${response.status}`));
  }
  return response.json();
}

function playbackPosition(playback?: WatchState['playback']) {
  if (!playback) return 0;
  if (playback.status !== 'playing') return playback.position || 0;
  return (playback.position || 0) + (Date.now() - playback.updatedAt) / 1000;
}

function downloadUrlFor(url: string) {
  if (!url.startsWith('/')) return url;
  const next = new URL(url, window.location.origin);
  next.searchParams.set('download', '1');
  return next.toString();
}

export default function WatchRoomClient({ sessionId }: { sessionId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<any>(null);
  const applyingRemoteState = useRef(false);
  const [state, setState] = useState<WatchState | null>(null);
  const [query, setQuery] = useState('');
  const [connected, setConnected] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [mediaStatus, setMediaStatus] = useState('Waiting for media');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);

  const endpointSnippet = useMemo(() => `POST /api/discord/chat

{
  "guildId": "local",
  "channelId": "watch",
  "userId": "123",
  "userName": "tester",
  "message": "!wr big buck bunny"
}`, []);

  async function refresh() {
    try {
      const nextState = await api(`/api/watch/sessions/${sessionId}/state`);
      setState(nextState);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }

  async function sendControl(action: string, position = videoRef.current?.currentTime || 0) {
    try {
      const nextState = await api(`/api/watch/sessions/${sessionId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action, position }),
      });
      setControlError(null);
      setState(nextState);
      return nextState;
    } catch (error: any) {
      const message = error?.message || 'Control failed';
      setControlError(message);
      setMediaStatus(message);
      throw error;
    }
  }

  function setPlayerVolume(nextVolume: number) {
    const normalized = Math.max(0, Math.min(1, nextVolume));
    setVolume(normalized);
    if (normalized > 0 && muted) setMuted(false);
  }

  function toggleMute() {
    setMuted((current) => !current);
  }

  async function playLocalAndRemote() {
    const video = videoRef.current;
    if (video) {
      try {
        await video.play();
      } catch (error: any) {
        const message = error?.message || 'Press the native video play button';
        setMediaStatus(`Play blocked: ${message}`);
      }
    }
    await sendControl('play').catch(() => {});
  }

  async function pauseLocalAndRemote() {
    videoRef.current?.pause();
    await sendControl('pause').catch(() => {});
  }

  async function openFullscreen() {
    const target = videoRef.current || playerShellRef.current;
    const video = videoRef.current as any;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (!target?.requestFullscreen) {
      if (typeof video?.webkitEnterFullscreen === 'function') {
        video.webkitEnterFullscreen();
        return;
      }
      setControlError('Fullscreen is not available in this view. Use Pop Out instead.');
      return;
    }
    try {
      await target.requestFullscreen();
      setControlError(null);
    } catch (error: any) {
      if (typeof video?.webkitEnterFullscreen === 'function') {
        video.webkitEnterFullscreen();
        setControlError(null);
        return;
      }
      setControlError(error?.message || 'Fullscreen was blocked. Use Pop Out instead.');
      console.warn('[WatchRoom] Fullscreen failed', error);
    }
  }

  async function syncPlayback() {
    applyPlaybackState();
    setControlError(null);
    setMediaStatus('Synced');
  }

  async function nextItem() {
    try {
      const nextState = await sendControl('next', 0);
      setCurrentRequestId(null);
      if (!nextState.current) {
        videoRef.current?.pause();
        if (videoRef.current) videoRef.current.removeAttribute('src');
        setMediaStatus('Queue ended');
        return;
      }
      window.setTimeout(() => applyPlaybackState(nextState), 0);
    } catch {
      // sendControl already surfaces the error in the UI.
    }
  }

  async function clearQueue() {
    try {
      const nextState = await sendControl('clear', 0);
      setCurrentRequestId(null);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      setState(nextState);
      setMediaStatus('Cleared');
    } catch {
      // sendControl already surfaces the error in the UI.
    }
  }

  function downloadCurrent() {
    const item = state?.current?.item;
    if (!item?.playbackUrl) return;
    const url = downloadUrlFor(item.playbackUrl);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${String(item.title || 'watch-video').replace(/[^a-z0-9_-]+/gi, '-')}.mp4`;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setControlError(null);
  }

  function openPopout() {
    const item = state?.current?.item;
    if (!item?.playbackUrl) return;
    const popout = window.open('', `watch-popout-${sessionId}`, 'popup=yes,width=1100,height=680');
    if (!popout) {
      setMediaStatus('Popout blocked by browser');
      return;
    }
    const playbackUrl = JSON.stringify(item.playbackUrl);
    const title = String(item.title || 'Watch video').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] || char);
    popout.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #000; color: #e5edf5; font-family: Arial, system-ui, sans-serif; }
    body { display: grid; grid-template-rows: auto 1fr; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; background: #111827; border-bottom: 1px solid #334155; }
    strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { border: 1px solid #475569; background: #1e293b; color: #e5edf5; border-radius: 6px; padding: 7px 10px; cursor: pointer; }
    video { width: 100%; height: 100%; background: #000; display: block; }
  </style>
</head>
<body>
  <header><strong>${title}</strong><button onclick="document.querySelector('video').requestFullscreen()">Fullscreen</button></header>
  <video id="video" controls autoplay playsinline></video>
  <script>
    const src = ${playbackUrl};
    const video = document.getElementById('video');
    if (src.endsWith('.m3u8')) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      script.onload = () => {
        if (window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls();
          hls.loadSource(src);
          hls.attachMedia(video);
        } else {
          video.src = src;
        }
      };
      document.head.appendChild(script);
    } else {
      video.src = src;
    }
  </script>
</body>
</html>`);
    popout.document.close();
  }

  function applyPlaybackState(nextState = state) {
    const video = videoRef.current;
    if (!video || !nextState?.current) return;

    const remotePosition = playbackPosition(nextState.playback);
    const drift = Math.abs((video.currentTime || 0) - remotePosition);
    applyingRemoteState.current = true;

    if (drift > 2.5 && Number.isFinite(remotePosition)) {
      video.currentTime = remotePosition;
    }

    if (nextState.playback.status === 'playing' && video.paused) {
      video.play().catch((error) => {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.warn('[WatchRoom] video.play() failed', message);
        setMediaStatus(`Play blocked: ${message}`);
      });
    }

    if (nextState.playback.status !== 'playing' && !video.paused) {
      video.pause();
    }

    window.setTimeout(() => {
      applyingRemoteState.current = false;
    }, 100);
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    const video = videoRef.current;
    const item = state?.current?.item;
    if (!video || !item || state.current.requestId === currentRequestId) {
      applyPlaybackState(state || undefined);
      return;
    }

    setCurrentRequestId(state.current.requestId);
    video.poster = '';

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setMediaStatus(`Loading ${item.title}`);
    console.log('[WatchRoom] Loading media', {
      title: item.title,
      playbackUrl: item.playbackUrl,
      requestId: state.current.requestId,
    });

    if (item.playbackUrl.endsWith('.m3u8')) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (state.current?.requestId !== currentRequestId && Hls.isSupported()) {
            hlsRef.current = new Hls();
            hlsRef.current.loadSource(item.playbackUrl);
            hlsRef.current.attachMedia(video);
            return;
          }

          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = item.playbackUrl;
          } else if (!Hls.isSupported()) {
            setMediaStatus('HLS is not supported in this browser');
          }
        })
        .catch((error) => {
          console.error('[WatchRoom] Failed to load HLS player', error);
          setMediaStatus('Failed to load HLS player');
        });
    } else {
      video.src = item.playbackUrl;
    }

    applyPlaybackState(state);
  }, [state?.current?.requestId]);

  useEffect(() => {
    applyPlaybackState();
  }, [state?.playback.status, state?.playback.position, state?.playback.updatedAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setRequestError(null);
    try {
      const result = await api(`/api/watch/sessions/${sessionId}/request`, {
        method: 'POST',
        body: JSON.stringify({ query: trimmed, username: 'local tester' }),
      });
      setQuery('');
      setState(result.session);
    } catch (error: any) {
      setRequestError(`${error.message || 'Request failed'}. Try Big Buck Bunny, Sintel, Tears of Steel, or HLS.`);
    }
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-3 text-slate-100 md:p-5">
      <div className="grid min-h-[calc(100vh-24px)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border border-slate-700 bg-[#171b20]">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-1 text-xs uppercase text-slate-400">Discord Watch Requests</p>
              <h1 className="text-2xl font-semibold">Room {sessionId}</h1>
            </div>
            <div className={`rounded-full border px-3 py-1 text-sm ${connected ? 'border-emerald-500/60 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
              {connected ? 'Live' : 'Disconnected'}
            </div>
          </div>

          <div ref={playerShellRef} className="relative aspect-video bg-black">
            <video
              ref={videoRef}
              className="h-full w-full bg-black"
              controls
              playsInline
              onSeeked={() => {
                if (!applyingRemoteState.current && state?.current) sendControl('seek');
              }}
              onCanPlay={() => {
                setMediaStatus('Ready to play');
                console.log('[WatchRoom] Media can play');
              }}
              onPlaying={() => {
                setMediaStatus('Playing');
                console.log('[WatchRoom] Media playing');
              }}
              onPause={() => {
                setMediaStatus('Paused');
              }}
              onError={() => {
                const mediaError = videoRef.current?.error;
                const message = mediaError ? `Media error ${mediaError.code}` : 'Unknown media error';
                setMediaStatus(message);
                console.error('[WatchRoom] Media error', mediaError);
              }}
              onEnded={() => {
                setMediaStatus('ended');
              }}
            />
            {!state?.current && (
              <div className="absolute inset-0 grid place-content-center gap-2 bg-black text-center text-slate-400">
                <strong className="text-slate-100">No video loaded</strong>
                <span>Use the request panel or type !wr in Discord.</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 p-4">
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={playLocalAndRemote}>Play</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={pauseLocalAndRemote}>Pause</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={syncPlayback}>Sync</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={nextItem}>Next</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={clearQueue}>Clear Queue</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400 disabled:opacity-50" onClick={openPopout} disabled={!state?.current}>Pop Out</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400 disabled:opacity-50" onClick={openFullscreen} disabled={!state?.current}>Fullscreen</button>
            {state?.current?.item?.playbackUrl && !String(state.current.item.playbackUrl).endsWith('.m3u8') && (
              <button
                type="button"
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400"
                onClick={downloadCurrent}
              >
                Download
              </button>
            )}
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2">
              <button type="button" className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm hover:border-emerald-400" onClick={toggleMute}>
                {muted || volume === 0 ? 'Muted' : 'Volume'}
              </button>
              <input
                className="h-2 flex-1 accent-emerald-400"
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(event) => setPlayerVolume(Number(event.target.value) / 100)}
                aria-label="Video volume"
              />
              <span className="w-10 text-right text-sm text-slate-300">{muted ? 0 : Math.round(volume * 100)}%</span>
            </div>
          </div>
          {controlError && <div className="border-t border-slate-700 px-4 py-2 text-sm text-amber-300">{controlError}</div>}

          <div className="px-4 pb-4 text-slate-400">
            {state?.current ? (
              <>
                <strong className="block text-slate-100">{state.current.item.title} ({state.current.item.year})</strong>
                <span>{state.current.item.source} · requested by {state.current.requestedBy.username}</span>
                <span className="mt-1 block text-sm">Media: {mediaStatus}</span>
              </>
            ) : (
              <span>Waiting for a request</span>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-700 bg-[#171b20] p-4">
            <h2 className="mb-3 font-semibold">Test Request</h2>
            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-1" onSubmit={submitRequest}>
              <input
                className="min-h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try Big Buck Bunny, Sintel, HLS"
              />
              <button className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" type="submit">Request</button>
            </form>
            {requestError && (
              <p className="mt-3 rounded-md border border-red-500/40 bg-red-950/40 p-2 text-sm text-red-200">{requestError}</p>
            )}
            <p className="mt-3 text-sm text-slate-400">This uses the same queue API as the Discord command handler.</p>
          </section>

          <section className="rounded-lg border border-slate-700 bg-[#171b20] p-4">
            <h2 className="mb-3 font-semibold">Queue</h2>
            <div className="grid gap-2">
              {state?.queue?.length ? state.queue.map((entry, index) => (
                <div key={entry.requestId} className="rounded-md border border-slate-700 bg-slate-950 p-3">
                  <strong className="block">{index + 1}. {entry.item.title}</strong>
                  <span className="text-sm text-slate-400">requested by {entry.requestedBy.username}</span>
                </div>
              )) : <div className="rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-400">Queue is empty.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-700 bg-[#171b20] p-4">
            <h2 className="mb-3 font-semibold">Activity</h2>
            <div className="grid gap-2">
              {state?.events?.length ? state.events.map((entry) => (
                <div key={entry.id} className="rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-400">
                  {new Date(entry.at).toLocaleTimeString()} · {entry.message}
                </div>
              )) : <div className="rounded-md border border-slate-700 bg-slate-950 p-3 text-sm text-slate-400">No activity yet.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-700 bg-[#171b20] p-4">
            <h2 className="mb-3 font-semibold">Discord JSON Test</h2>
            <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs text-slate-400">{endpointSnippet}</pre>
          </section>
        </aside>
      </div>
    </main>
  );
}
