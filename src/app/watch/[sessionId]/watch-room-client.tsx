'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveYoutubeStream, submitResolvedStream, type ResolvedStream } from '@/lib/youtube-client-resolver';

type WatchState = {
  id: string;
  roomUrl: string;
  queue: Array<any>;
  ttsQueue?: Array<any>;
  current: any | null;
  playback: {
    status: 'idle' | 'paused' | 'playing';
    position: number;
    updatedAt: number;
    muted?: boolean;
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

function downloadUrlForItem(item: any) {
  const idMatch = String(item?.id || '').match(/^xtream-(vod|series)-(\d+)$/i);
  if (idMatch) return `/activity-provider/xtream/${idMatch[1].toLowerCase()}/${idMatch[2]}?download=1`;
  const playbackUrl = String(playbackUrlForItem(item) || '');
  if (isEmbeddedVideoUrl(playbackUrl)) return '';
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return `/activity-provider/xtream/episode/${episodeMatch[1]}?download=1`;
  return playbackUrl ? downloadUrlFor(playbackUrl) : '';
}

function isBrowserLimitedVideo(item: any) {
  return String(item?.overview || '').toLowerCase().includes('(mkv)');
}

function hlsFallbackUrlFor(item: any) {
  const playbackUrl = String(playbackUrlForItem(item) || '');
  const match = playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series)\/(\d+)$/i);
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return `/api/watch/xtream/hls/episode-${episodeMatch[1].toLowerCase()}/index.m3u8`;
  if (!match || !isBrowserLimitedVideo(item)) return playbackUrl;
  return `/api/watch/xtream/hls/${match[1].toLowerCase()}-${match[2]}/index.m3u8`;
}

function musicModeOptions(item: any) {
  const metadata = item?.metadata || {};
  return {
    video: metadata.videoPlaybackUrl || item?.playbackUrl || '',
    audio: metadata.audioPlaybackUrl || '',
  };
}

function hasMusicModeToggle(item: any) {
  const options = musicModeOptions(item);
  return item?.type === 'music' && Boolean(options.video && options.audio);
}

function playbackUrlForItem(item: any, mode?: 'audio' | 'video') {
  if (hasMusicModeToggle(item)) {
    const options = musicModeOptions(item);
    return (mode || item?.metadata?.playbackMode || 'video') === 'audio' ? options.audio : options.video;
  }
  return item?.playbackUrl || '';
}

function isEmbeddedVideoUrl(value: string) {
  const raw = String(value || '').toLowerCase();
  return raw.includes('youtube.com/embed/') || raw.includes('youtube-nocookie.com/embed/');
}

function iframeUrlFor(value: string, showControls = true) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    if (!isEmbeddedVideoUrl(url.toString())) return value;
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
    if (!showControls) url.searchParams.set('controls', '0');
    return url.toString();
  } catch {
    return value;
  }
}

function isHlsPlaybackUrl(value: string) {
  if (!value) return false;
  if (value.split('?')[0].endsWith('.m3u8')) return true;
  try {
    const parsed = new URL(value, window.location.origin);
    const proxied = parsed.searchParams.get('url');
    return Boolean(proxied?.split('?')[0].endsWith('.m3u8'));
  } catch {
    return false;
  }
}

function mediaErrorMessage(error: MediaError | null | undefined) {
  if (!error) return 'Unknown media error';
  if (error.code === MediaError.MEDIA_ERR_ABORTED) return 'Media load was aborted';
  if (error.code === MediaError.MEDIA_ERR_NETWORK) return 'Network error while loading media';
  if (error.code === MediaError.MEDIA_ERR_DECODE) return 'Browser could not decode this video stream';
  if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return 'Browser does not support this video format';
  return `Media error ${error.code}`;
}

const YOUTUBE_CLIENT_RESOLVE_WAIT_MS = 4500;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function youtubeVideoIdForItem(item: any) {
  const videoId = String(item?.metadata?.videoId || String(item?.id || '').replace(/^youtube-/, '') || '').trim();
  return YOUTUBE_VIDEO_ID_RE.test(videoId) ? videoId : '';
}

function youtubeEmbedUrlForItem(item: any) {
  const videoId = youtubeVideoIdForItem(item);
  return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : '';
}

function shouldResolveYoutubeInBrowser(item: any) {
  return Boolean(youtubeVideoIdForItem(item) && item?.metadata?.playbackStrategy === 'proxy');
}

async function resolveYoutubeInBrowser(videoId: string) {
  let timedOut = false;
  const stream = await Promise.race<ResolvedStream | null>([
    resolveYoutubeStream(videoId),
    new Promise<null>((resolve) => {
      window.setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, YOUTUBE_CLIENT_RESOLVE_WAIT_MS);
    }),
  ]);

  if (!stream) return { ok: false, reason: timedOut ? 'timed out' : 'no streams resolved' };
  const submitted = await submitResolvedStream(videoId, stream);
  return { ok: submitted, reason: submitted ? 'submitted' : 'submit failed' };
}

function shouldShowMkvFallbackNotice(item: any, mediaStatus: string) {
  if (!isBrowserLimitedVideo(item)) return false;
  const status = mediaStatus.toLowerCase();
  return !status.includes('ready') && !status.includes('playing');
}

export default function WatchRoomClient({ sessionId, activityMode = false, canPause = false }: { sessionId: string; activityMode?: boolean; canPause?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<any>(null);
  const applyingRemoteState = useRef(false);
  const syncingNativePlayback = useRef(false);
  const embeddedCurrentTimeRef = useRef(0);
  const lastEmbeddedPlaybackKeyRef = useRef('');
  const ttsSeenRef = useRef<Set<string>>(new Set());
  const ttsQueueRef = useRef<any[]>([]);
  const ttsPlayingRef = useRef(false);
  const localAudioUnlockedRef = useRef(false);
  const [state, setState] = useState<WatchState | null>(null);
  const [query, setQuery] = useState('');
  const [connected, setConnected] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [mediaStatus, setMediaStatus] = useState('Waiting for media');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [volume, setVolume] = useState(activityMode ? 1 : 0.85);
  const [muted, setMuted] = useState(activityMode);
  const [dismissedMkvNoticeFor, setDismissedMkvNoticeFor] = useState<string | null>(null);
  const [musicPlaybackMode, setMusicPlaybackMode] = useState<'audio' | 'video'>('video');
  const [ttsOverlayEnabled, setTtsOverlayEnabled] = useState(false);
  const [embedFallback, setEmbedFallback] = useState<{ requestId: string; url: string } | null>(null);

  const currentItem = state?.current?.item;
  const activeEmbedFallback = embedFallback?.requestId === state?.current?.requestId ? embedFallback : null;
  const currentPlaybackUrl = activeEmbedFallback
    ? activeEmbedFallback.url
    : currentItem ? playbackUrlForItem(currentItem, musicPlaybackMode) : '';
  const embeddedMode = Boolean(currentPlaybackUrl && isEmbeddedVideoUrl(currentPlaybackUrl));

  function youtubeCommand(func: string, args: unknown[] = []) {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
      return true;
    } catch (error) {
      console.warn('[WatchRoom] YouTube command failed', func, error);
      return false;
    }
  }

  function registerYouTubeListeners() {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*');
    } catch (error) {
      console.warn('[WatchRoom] YouTube listener registration failed', error);
    }
  }

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
      setState((prev) => {
        if (!prev) return nextState;
        return (nextState?.playback?.updatedAt || 0) >= (prev?.playback?.updatedAt || 0) ? nextState : prev;
      });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }

  async function sendControl(action: string, position = videoRef.current?.currentTime || 0) {
    try {
      const nextState = await api(`/api/watch/sessions/${sessionId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action, position, isHost: canPause || activityMode, isAdmin: canPause || activityMode, platform: activityMode ? 'activity' : 'web' }),
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
    if (embeddedMode) {
      youtubeCommand('setVolume', [Math.round(normalized * 100)]);
      youtubeCommand(muted || normalized === 0 ? 'mute' : 'unMute');
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    localAudioUnlockedRef.current = true;
    setMuted(nextMuted);
    if (embeddedMode) youtubeCommand(nextMuted ? 'mute' : 'unMute');
    if (canPause && state?.current) sendControl(nextMuted ? 'mute' : 'unmute').catch(() => {});
  }

  function saveSeenTtsIds() {
    try {
      window.localStorage.setItem('hmo_watch_tts_seen', JSON.stringify(Array.from(ttsSeenRef.current).slice(-200)));
    } catch {}
  }

  function playNextTtsOverlay() {
    if (!ttsOverlayEnabled || ttsPlayingRef.current || !ttsQueueRef.current.length) return;
    const request = ttsQueueRef.current.shift();
    const audioUrl = request?.item?.playbackUrl;
    if (!audioUrl) {
      playNextTtsOverlay();
      return;
    }
    ttsPlayingRef.current = true;
    const audio = new Audio(audioUrl);
    audio.volume = Math.max(0.15, volume);
    audio.addEventListener('ended', () => {
      ttsPlayingRef.current = false;
      playNextTtsOverlay();
    }, { once: true });
    audio.addEventListener('error', () => {
      ttsPlayingRef.current = false;
      playNextTtsOverlay();
    }, { once: true });
    audio.play().catch((error) => {
      ttsPlayingRef.current = false;
      setMediaStatus(`TTS blocked: ${error?.message || 'click Enable Sound first'}`);
    });
  }

  async function enableSound() {
    localAudioUnlockedRef.current = true;
    if (embeddedMode) {
      setMuted(false);
      setVolume(1);
      youtubeCommand('setVolume', [100]);
      youtubeCommand('unMute');
      youtubeCommand('playVideo');
      setMediaStatus('Playing with sound enabled');
      return;
    }
    const video = videoRef.current;
    setMuted(false);
    setVolume(1);
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    try {
      await video.play();
      setMediaStatus('Playing with sound enabled');
    } catch (error: any) {
      setMediaStatus(`Sound unlock failed: ${error?.message || 'press the native video play button'}`);
    }
  }

  async function playLocalAndRemote() {
    if (embeddedMode) {
      youtubeCommand('playVideo');
      if (canPause) await sendControl('play', embeddedCurrentTimeRef.current || playbackPosition(state?.playback)).catch(() => {});
      return;
    }
    const video = videoRef.current;
    if (video) {
      try {
        await video.play();
      } catch (error: any) {
        const message = error?.message || 'Press the native video play button';
        setMediaStatus(`Play blocked: ${message}`);
      }
    }
    if (canPause) await sendControl('play').catch(() => {});
  }

  async function pauseLocalAndRemote() {
    if (embeddedMode) {
      youtubeCommand('pauseVideo');
      await sendControl('pause', embeddedCurrentTimeRef.current || playbackPosition(state?.playback)).catch(() => {});
      return;
    }
    videoRef.current?.pause();
    await sendControl('pause').catch(() => {});
  }

  async function syncNativePlay() {
    const video = videoRef.current;
    if (!video || !state?.current || applyingRemoteState.current || syncingNativePlayback.current) return;
    if (!canPause) return;
    if (state.playback.status === 'playing') return;

    syncingNativePlayback.current = true;
    const position = video.currentTime || state.playback.position || 0;
    setState((current) => current
      ? {
          ...current,
          playback: {
            ...current.playback,
            status: 'playing',
            position,
            updatedAt: Date.now(),
          },
        }
      : current);
    try {
      await sendControl('play', position);
    } catch {
      // sendControl surfaces the error in the UI.
    } finally {
      syncingNativePlayback.current = false;
    }
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
      const nextState = activityMode
        ? (await api(`/api/watch/sessions/${sessionId}/quick-control?action=next&position=0&format=json&platform=discord`)).session
        : await sendControl('next', 0);
      setCurrentRequestId(null);
      setState(nextState);
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

  function downloadCurrent() {
    const item = state?.current?.item;
    if (!item) return;
    const url = downloadUrlForItem(item);
    if (!url) return;
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
    const popoutUrl = `/watch/${encodeURIComponent(sessionId)}?canPause=${canPause || activityMode ? '1' : '0'}`;
    const popout = window.open(popoutUrl, `watch-popout-${sessionId}`, 'popup=yes,width=1100,height=680');
    if (!popout) {
      setMediaStatus('Popout blocked by browser');
      return;
    }
    popout.focus();
  }

  async function clearQueue() {
    try {
      const nextState = activityMode
        ? (await api(`/api/watch/sessions/${sessionId}/quick-control?action=clear&position=0&format=json&platform=activity&isHost=true`)).session
        : await sendControl('clear', 0);
      setCurrentRequestId(null);
      setState(nextState);
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.removeAttribute('src');
      setMediaStatus('Queue cleared');
    } catch {
      // sendControl/control already surfaces the error in the UI.
    }
  }

  function applyPlaybackState(nextState = state) {
    if (embeddedMode && nextState?.current) {
      const remotePosition = playbackPosition(nextState.playback);
      const playbackKey = [
        nextState.current.requestId,
        nextState.playback.status,
        Math.round(Number(nextState.playback.position || 0)),
        Number(nextState.playback.updatedAt || 0),
      ].join(':');
      if (playbackKey !== lastEmbeddedPlaybackKeyRef.current && Number.isFinite(remotePosition)) {
        lastEmbeddedPlaybackKeyRef.current = playbackKey;
        youtubeCommand('seekTo', [Math.max(0, remotePosition), true]);
      }
      youtubeCommand(nextState.playback.status === 'playing' ? 'playVideo' : 'pauseVideo');
      youtubeCommand('setVolume', [Math.round(volume * 100)]);
      youtubeCommand(muted || volume === 0 ? 'mute' : 'unMute');
      setMediaStatus(nextState.playback.status === 'playing' ? 'Embedded video playing' : 'Embedded video ready');
      return;
    }

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
    try {
      setTtsOverlayEnabled(window.localStorage.getItem('hmo_watch_tts_overlay') === '1');
      const seen = JSON.parse(window.localStorage.getItem('hmo_watch_tts_seen') || '[]');
      ttsSeenRef.current = new Set(Array.isArray(seen) ? seen.map(String) : []);
    } catch {}
  }, []);

  useEffect(() => {
    const incoming = Array.isArray(state?.ttsQueue) ? state.ttsQueue : [];
    incoming.forEach((request) => {
      const id = String(request?.requestId || '');
      if (!id || ttsSeenRef.current.has(id)) return;
      ttsSeenRef.current.add(id);
      if (ttsOverlayEnabled) ttsQueueRef.current.push(request);
    });
    if (ttsSeenRef.current.size > 220) {
      ttsSeenRef.current = new Set(Array.from(ttsSeenRef.current).slice(-200));
    }
    saveSeenTtsIds();
    playNextTtsOverlay();
  }, [state?.ttsQueue, ttsOverlayEnabled]);

  useEffect(() => {
    const video = videoRef.current;
    const item = state?.current?.item;
    if (!item || state.current.requestId === currentRequestId) {
      applyPlaybackState(state || undefined);
      return;
    }

    setCurrentRequestId(state.current.requestId);
    setMusicPlaybackMode(item?.metadata?.playbackMode || 'video');
    embeddedCurrentTimeRef.current = 0;
    lastEmbeddedPlaybackKeyRef.current = '';
    if (video) video.poster = '';

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

    const loadingRequestId = state.current.requestId;
    let cancelled = false;
    let youtubeFallbackTimer: number | null = null;
    setEmbedFallback(null);

    async function loadMedia() {
      if (shouldResolveYoutubeInBrowser(item)) {
        const ytVideoId = youtubeVideoIdForItem(item);
        setMediaStatus('Resolving YouTube stream in this browser');
        const resolved = await resolveYoutubeInBrowser(ytVideoId);
        if (cancelled) return;
        console.log('[WatchRoom] Browser YouTube resolve result', {
          videoId: ytVideoId,
          ok: resolved.ok,
          reason: resolved.reason,
        });
        if (resolved.ok) {
          setMediaStatus('Browser stream resolved; preparing HLS');
        } else {
          const fallbackUrl = youtubeEmbedUrlForItem(item);
          if (fallbackUrl) {
            setMediaStatus(`Browser stream resolve ${resolved.reason}; using YouTube embed`);
            setEmbedFallback({ requestId: loadingRequestId, url: fallbackUrl });
            return;
          }
          setMediaStatus(`Browser stream resolve ${resolved.reason}; trying server fallback`);
        }
      }

      const mediaUrl = hlsFallbackUrlFor(item);
      const usesHlsFallback = mediaUrl !== item.playbackUrl;

      if (isEmbeddedVideoUrl(mediaUrl)) {
        if (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
        setMediaStatus('Embedded video ready');
        window.setTimeout(() => {
          if (cancelled) return;
          registerYouTubeListeners();
          applyPlaybackState(state);
        }, 600);
        return;
      }

      if (!video) return;

      if (isHlsPlaybackUrl(mediaUrl)) {
        import('hls.js')
          .then(({ default: Hls }) => {
            if (cancelled) return;
            if (state?.current?.requestId === loadingRequestId && Hls.isSupported()) {
              hlsRef.current = new Hls();
              hlsRef.current.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
                const detail = data?.details || data?.type || 'HLS playback error';
                setMediaStatus(`HLS error: ${detail}`);
                console.error('[WatchRoom] HLS error', data);
                const fallbackUrl = youtubeEmbedUrlForItem(item);
                if (data?.fatal && fallbackUrl) {
                  hlsRef.current?.destroy();
                  hlsRef.current = null;
                  if (video) {
                    video.pause();
                    video.removeAttribute('src');
                    video.load();
                  }
                  setMediaStatus('HLS failed; switching to YouTube embed fallback');
                  setEmbedFallback({ requestId: loadingRequestId, url: fallbackUrl });
                }
              });
              hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
                if (youtubeFallbackTimer !== null) {
                  window.clearTimeout(youtubeFallbackTimer);
                  youtubeFallbackTimer = null;
                }
                setMediaStatus(usesHlsFallback ? 'HLS fallback ready' : 'Ready to play');
                // Force playback from server position (0 for new items) so VOD doesn't resume from end
                const targetPos = playbackPosition(state?.playback);
                if (video && Number.isFinite(targetPos)) video.currentTime = targetPos;
              });
              hlsRef.current.loadSource(mediaUrl);
              hlsRef.current.attachMedia(video);
              const fallbackUrl = youtubeEmbedUrlForItem(item);
              if (fallbackUrl && shouldResolveYoutubeInBrowser(item)) {
                youtubeFallbackTimer = window.setTimeout(() => {
                  if (cancelled) return;
                  hlsRef.current?.destroy();
                  hlsRef.current = null;
                  setMediaStatus('HLS timed out; switching to YouTube embed fallback');
                  setEmbedFallback({ requestId: loadingRequestId, url: fallbackUrl });
                }, 15000);
              }
              setMediaStatus(usesHlsFallback ? 'Preparing browser-compatible HLS stream' : `Loading ${item.title}`);
              return;
            }

            if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = mediaUrl;
            } else if (!Hls.isSupported()) {
              setMediaStatus('HLS is not supported in this browser');
            }
          })
          .catch((error) => {
            console.error('[WatchRoom] Failed to load HLS player', error);
            setMediaStatus('Failed to load HLS player');
          });
      } else {
        video.src = mediaUrl;
        if (isBrowserLimitedVideo(item)) {
          setMediaStatus('MKV stream loaded. Browser playback may not be supported; use Download if video stays black.');
        }
      }

      applyPlaybackState(state);
    }

    loadMedia();
    return () => {
      cancelled = true;
      if (youtubeFallbackTimer !== null) window.clearTimeout(youtubeFallbackTimer);
    };
  }, [state?.current?.requestId, musicPlaybackMode]);

  useEffect(() => {
    applyPlaybackState();
  }, [state?.playback.status, state?.playback.position, state?.playback.updatedAt]);

  useEffect(() => {
    const video = videoRef.current;
    if (embeddedMode) {
      youtubeCommand('setVolume', [Math.round(volume * 100)]);
      youtubeCommand(muted || volume === 0 ? 'mute' : 'unMute');
      return;
    }
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, embeddedMode]);

  useEffect(() => {
    if (!localAudioUnlockedRef.current && typeof state?.playback?.muted === 'boolean') {
      setMuted(state.playback.muted);
    }
  }, [state?.current?.requestId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      let payload: any = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== 'object') return;

      if (payload.event === 'infoDelivery' && typeof payload.info?.currentTime === 'number') {
        embeddedCurrentTimeRef.current = payload.info.currentTime;
      }

      if (payload.event !== 'onStateChange') return;
      const code = Number(payload.info);
      if (code === 1) {
        setMediaStatus('Embedded video playing');
        if (canPause && state?.playback?.status !== 'playing') sendControl('play', embeddedCurrentTimeRef.current).catch(() => {});
      } else if (code === 2) {
        setMediaStatus('Embedded video paused');
        if (canPause && state?.playback?.status === 'playing') sendControl('pause', embeddedCurrentTimeRef.current).catch(() => {});
      } else if (code === 0) {
        setMediaStatus('Embedded video ended');
        if (canPause) nextItem().catch(() => {});
      } else if (code === 3) {
        setMediaStatus('Embedded video buffering');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [state?.playback?.status, embeddedMode, canPause]);

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setRequestError(null);
    try {
      const result = await api(`/api/watch/sessions/${sessionId}/request`, {
        method: 'POST',
        body: JSON.stringify({
          query: trimmed,
          username: 'local tester',
          mediaType: sessionId === 'discord-music-room' || sessionId.toLowerCase().includes('music') ? 'music' : 'video',
          announceDiscord: sessionId === 'discord-watch-room' || sessionId === 'discord-music-room',
        }),
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
            {embeddedMode && currentPlaybackUrl && (
              <iframe
                ref={iframeRef}
                className="absolute inset-0 h-full w-full border-0 bg-black"
                src={iframeUrlFor(currentPlaybackUrl, false)}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ pointerEvents: 'none' }}
                onLoad={() => {
                  registerYouTubeListeners();
                  applyPlaybackState();
                }}
              />
            )}
            <video
              ref={videoRef}
              className={`h-full w-full bg-black ${embeddedMode ? 'hidden' : ''}`}
              controls={false}
              style={{ pointerEvents: 'none' }}
              muted={muted}
              autoPlay={activityMode}
              playsInline
              onSeeked={() => {
                if (canPause && !applyingRemoteState.current && state?.current) sendControl('seek');
              }}
              onCanPlay={() => {
                setMediaStatus('Ready to play');
                console.log('[WatchRoom] Media can play');
                applyPlaybackState();
              }}
              onPlaying={() => {
                setMediaStatus('Playing');
                console.log('[WatchRoom] Media playing');
                syncNativePlay();
              }}
              onPause={() => {
                setMediaStatus('Paused');
              }}
              onVolumeChange={() => {
                const video = videoRef.current;
                if (!video) return;
                localAudioUnlockedRef.current = true;
                setMuted(video.muted);
                setVolume(video.volume);
              }}
              onError={() => {
                const mediaError = videoRef.current?.error;
                const message = mediaErrorMessage(mediaError);
                setMediaStatus(message);
                console.error('[WatchRoom] Media error', mediaError);
              }}
              onEnded={() => {
                setMediaStatus('ended');
                if (canPause) nextItem();
              }}
            />
            {!state?.current && (
              <div className="absolute inset-0 grid place-content-center gap-2 bg-black text-center text-slate-400">
                <strong className="text-slate-100">No video loaded</strong>
                <span>Use the request panel or type !wr in Discord.</span>
              </div>
            )}
          </div>

          {state?.current
            && state.current.requestId !== dismissedMkvNoticeFor
            && shouldShowMkvFallbackNotice(state.current.item, mediaStatus) && (
              <div className="flex items-start gap-3 border-t border-amber-400/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
                <p className="min-w-0 flex-1">
                  This provider returned an MKV stream. The app is preparing an HLS browser fallback; use Pop Out or Download if conversion is slow or playback still fails.
                </p>
                <button
                  type="button"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded border border-amber-300/40 bg-black/30 text-amber-100 hover:border-amber-200"
                  aria-label="Dismiss MKV fallback notice"
                  title="Dismiss"
                  onClick={() => setDismissedMkvNoticeFor(state.current?.requestId || null)}
                >
                  x
                </button>
              </div>
            )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 p-4">
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={playLocalAndRemote}>Play</button>
            {canPause && (
              <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={pauseLocalAndRemote}>Pause</button>
            )}
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={syncPlayback}>Sync</button>
            {(canPause || activityMode) && (
              <>
                <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={nextItem}>Next</button>
                <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400" onClick={clearQueue}>Clear</button>
              </>
            )}
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400 disabled:opacity-50" onClick={openPopout} disabled={!state?.current}>Pop Out</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400 disabled:opacity-50" onClick={openFullscreen} disabled={!state?.current}>Fullscreen</button>
            <button type="button" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400 disabled:opacity-50" onClick={enableSound} disabled={!state?.current}>Enable Sound</button>
            <button
              type="button"
              className={`rounded-md border px-3 py-2 ${ttsOverlayEnabled ? 'border-emerald-400 bg-emerald-950/40 text-emerald-100' : 'border-slate-700 bg-slate-800 hover:border-emerald-400'}`}
              onClick={() => {
                const next = !ttsOverlayEnabled;
                setTtsOverlayEnabled(next);
                try {
                  window.localStorage.setItem('hmo_watch_tts_overlay', next ? '1' : '0');
                } catch {}
              }}
            >
              {ttsOverlayEnabled ? 'TTS On' : 'TTS Off'}
            </button>
            {state?.current?.item && hasMusicModeToggle(state.current.item) && (
              <button
                type="button"
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 hover:border-emerald-400"
                onClick={() => {
                  const nextMode = musicPlaybackMode === 'audio' ? 'video' : 'audio';
                  const wasPlaying = state.playback.status === 'playing';
                  const position = embeddedMode ? embeddedCurrentTimeRef.current : videoRef.current?.currentTime || playbackPosition(state.playback);
                  setMusicPlaybackMode(nextMode);
                  setCurrentRequestId(null);
                  if (canPause && Number.isFinite(position)) sendControl('seek', position).catch(() => {});
                  if (wasPlaying) window.setTimeout(() => playLocalAndRemote(), 300);
                }}
              >
                {musicPlaybackMode === 'audio' ? 'Audio' : 'Video'}
              </button>
            )}
            {state?.current?.item && downloadUrlForItem(state.current.item) && (
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
