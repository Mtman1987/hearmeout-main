'use client';

// OBS overlay media lane.
//
// Voice chat stays in the normal room browser. Movies and music play here so
// streamers can route this browser source to a separate OBS audio track.

import { useParams, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Music, Play, Volume2, VolumeX, Film, Users, ListMusic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePopout } from '@/components/PopoutWidgets/PopoutProvider';
import { getRoomWatchSessionId } from '@/lib/watch-session';
import { useCollection } from '@/hooks/use-db';

type WatchPlayback = {
  status: 'idle' | 'paused' | 'playing';
  position: number;
  updatedAt: number;
  muted?: boolean;
};

type WatchRequest = {
  requestId: string;
  item: any;
  requestedBy?: { username?: string };
};

type WatchState = {
  id: string;
  queue: WatchRequest[];
  current: WatchRequest | null;
  playback: WatchPlayback;
};

type MediaLane = 'auto' | 'music' | 'movie';

type OverlayProfile = {
  id: string;
  uid?: string;
  displayName?: string;
  photoURL?: string;
  lastSeen?: number;
};

type OverlayViewState = {
  volume: number;
  muted: boolean;
  musicPlaybackMode: 'video' | 'audio';
  showNowPlaying: boolean;
  showMusicQueue: boolean;
  showProfiles: boolean;
};

async function api(path: string) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function playbackPosition(playback?: WatchPlayback) {
  if (!playback) return 0;
  if (playback.status !== 'playing') return playback.position || 0;
  return (playback.position || 0) + (Date.now() - playback.updatedAt) / 1000;
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

function playbackUrlForItem(item: any, mode: 'video' | 'audio' = 'video') {
  if (hasMusicModeToggle(item)) {
    const options = musicModeOptions(item);
    return mode === 'audio' ? options.audio : options.video;
  }
  return item?.playbackUrl || '';
}

function hlsFallbackUrlFor(item: any, mode: 'video' | 'audio' = 'video') {
  const playbackUrl = String(playbackUrlForItem(item, mode) || '');
  const isBrowserLimitedVideo = String(item?.overview || '').toLowerCase().includes('(mkv)');
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  const match = playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series)\/(\d+)$/i);
  if (episodeMatch) return `/api/watch/xtream/hls/episode-${episodeMatch[1].toLowerCase()}/index.m3u8`;
  if (!match || !isBrowserLimitedVideo) return playbackUrl;
  return `/api/watch/xtream/hls/${match[1].toLowerCase()}-${match[2]}/index.m3u8`;
}

function isEmbeddedVideoUrl(value: string) {
  const raw = String(value || '').toLowerCase();
  return raw.includes('youtube.com/embed/') || raw.includes('youtube-nocookie.com/embed/');
}

function iframeUrlFor(value: string) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    if (!isEmbeddedVideoUrl(url.toString())) return value;
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
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

function sessionHasActiveMedia(state: WatchState | null) {
  return Boolean(state?.current && state.playback?.status !== 'idle');
}

export default function OverlayPage() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roomId = params.roomId;
  const movieSessionId = getRoomWatchSessionId(roomId, 'movie');
  const musicSessionId = getRoomWatchSessionId(roomId, 'music');
  const requestedLane = (searchParams.get('media') || searchParams.get('lane') || 'auto').toLowerCase();
  const lane: MediaLane = requestedLane === 'music' || requestedLane === 'movie' ? requestedLane : 'auto';
  const { popouts, openPopout, closePopout } = usePopout();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hlsRef = useRef<any>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const applyingRemoteState = useRef(false);
  const embeddedCurrentTimeRef = useRef(0);
  const lastEmbeddedPlaybackKeyRef = useRef('');
  const volumeRef = useRef(0.5);
  const mutedRef = useRef(false);

  const [movieState, setMovieState] = useState<WatchState | null>(null);
  const [musicState, setMusicState] = useState<WatchState | null>(null);
  const [connected, setConnected] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [mediaStatus, setMediaStatus] = useState('Waiting for media');
  const [musicPlaybackMode, setMusicPlaybackMode] = useState<'video' | 'audio'>('video');
  const [showNowPlaying, setShowNowPlaying] = useState(true);
  const [showMusicQueue, setShowMusicQueue] = useState(true);
  const [showProfiles, setShowProfiles] = useState(true);
  const [viewStateHydrated, setViewStateHydrated] = useState(false);
  const { data: roomProfiles } = useCollection<OverlayProfile>(`rooms/${roomId}/users`, { pollInterval: 3000 });

  const activeProfiles = useMemo(() => (roomProfiles || []).filter((profile) => {
    const lastSeen = Number(profile.lastSeen || 0);
    return lastSeen > 0 && Date.now() - lastSeen < 45_000;
  }), [roomProfiles]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`hearmeout-overlay-view:v1:${roomId}`) || '{}') as Partial<OverlayViewState>;
      if (typeof saved.volume === 'number') {
        const nextVolume = Math.max(0, Math.min(1, saved.volume));
        volumeRef.current = nextVolume;
        setVolume(nextVolume);
      }
      if (typeof saved.muted === 'boolean') {
        mutedRef.current = saved.muted;
        setIsMuted(saved.muted);
      }
      if (saved.musicPlaybackMode === 'audio' || saved.musicPlaybackMode === 'video') setMusicPlaybackMode(saved.musicPlaybackMode);
      if (typeof saved.showNowPlaying === 'boolean') setShowNowPlaying(saved.showNowPlaying);
      if (typeof saved.showMusicQueue === 'boolean') setShowMusicQueue(saved.showMusicQueue);
      if (typeof saved.showProfiles === 'boolean') setShowProfiles(saved.showProfiles);
    } catch {}
    setViewStateHydrated(true);
  }, [roomId]);

  useEffect(() => {
    if (!viewStateHydrated) return;
    window.localStorage.setItem(`hearmeout-overlay-view:v1:${roomId}`, JSON.stringify({
      volume,
      muted: isMuted,
      musicPlaybackMode,
      showNowPlaying,
      showMusicQueue,
      showProfiles,
    } satisfies OverlayViewState));
  }, [isMuted, musicPlaybackMode, roomId, showMusicQueue, showNowPlaying, showProfiles, viewStateHydrated, volume]);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  const activeBundle = useMemo(() => {
    if (lane === 'music') return { lane: 'music' as const, sessionId: musicSessionId, state: musicState };
    if (lane === 'movie') return { lane: 'movie' as const, sessionId: movieSessionId, state: movieState };

    if (sessionHasActiveMedia(musicState)) return { lane: 'music' as const, sessionId: musicSessionId, state: musicState };
    if (sessionHasActiveMedia(movieState)) return { lane: 'movie' as const, sessionId: movieSessionId, state: movieState };
    if (musicState?.current) return { lane: 'music' as const, sessionId: musicSessionId, state: musicState };
    return { lane: 'movie' as const, sessionId: movieSessionId, state: movieState };
  }, [lane, movieSessionId, movieState, musicSessionId, musicState]);

  const activeState = activeBundle.state;
  const currentItem = activeState?.current?.item || null;
  const currentPlaybackUrl = currentItem
    ? hlsFallbackUrlFor(currentItem, currentItem?.type === 'music' ? musicPlaybackMode : 'video')
    : '';
  const embeddedMode = Boolean(currentPlaybackUrl && isEmbeddedVideoUrl(currentPlaybackUrl));

  const youtubeCommand = useCallback((func: string, args: unknown[] = []) => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
      return true;
    } catch (error) {
      console.warn('[Overlay] YouTube command failed', func, error);
      return false;
    }
  }, []);

  const applyVolume = useCallback(() => {
    const nextVolume = Math.max(0, Math.min(1, volumeRef.current));
    const muted = mutedRef.current || nextVolume === 0;
    if (embeddedMode) {
      youtubeCommand('setVolume', [Math.round(nextVolume * 100)]);
      youtubeCommand(muted ? 'mute' : 'unMute');
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.volume = nextVolume;
    video.muted = muted;
  }, [embeddedMode, youtubeCommand]);

  const registerYouTubeListeners = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*');
    } catch (error) {
      console.warn('[Overlay] YouTube listener registration failed', error);
    }
  }, []);

  const applyPlaybackState = useCallback((nextState = activeState) => {
    if (!nextState?.current) return;

    if (embeddedMode) {
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
      applyVolume();
      setMediaStatus(nextState.playback.status === 'playing' ? 'Overlay media playing' : 'Overlay media paused');
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    const remotePosition = playbackPosition(nextState.playback);
    const drift = Math.abs((video.currentTime || 0) - remotePosition);
    applyingRemoteState.current = true;

    if (drift > 2.5 && Number.isFinite(remotePosition)) {
      video.currentTime = remotePosition;
    }

    if (nextState.playback.status === 'playing' && video.paused) {
      video.play()
        .then(() => setAudioReady(true))
        .catch((error) => {
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          setMediaStatus(`Overlay autoplay blocked: ${message}`);
          console.warn('[Overlay] media.play() failed', message);
        });
    }

    if (nextState.playback.status !== 'playing' && !video.paused) {
      video.pause();
    }

    window.setTimeout(() => {
      applyingRemoteState.current = false;
    }, 100);
  }, [activeState, applyVolume, embeddedMode, youtubeCommand]);

  const startOverlayAudio = useCallback(async () => {
    mutedRef.current = false;
    setIsMuted(false);
    applyVolume();

    if (embeddedMode) {
      youtubeCommand('unMute');
      youtubeCommand('playVideo');
      setAudioReady(true);
      setMediaStatus('Overlay media unlocked');
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = volumeRef.current;
    await video.play();
    setAudioReady(true);
    setMediaStatus('Overlay media unlocked');
  }, [applyVolume, embeddedMode, youtubeCommand]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const [movie, music] = await Promise.all([
          api(`/api/watch/sessions/${movieSessionId}/state`),
          api(`/api/watch/sessions/${musicSessionId}/state`),
        ]);
        setMovieState(movie);
        setMusicState(music);
        setConnected(true);
      } catch (error) {
        setConnected(false);
        console.warn('[Overlay] watch-session refresh failed', error);
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [movieSessionId, musicSessionId]);

  useEffect(() => {
    const unlockOverlayAudio = () => {
      void startOverlayAudio().catch((error) => console.warn('[Overlay] start audio failed:', error));
    };
    window.addEventListener('pointerdown', unlockOverlayAudio, { passive: true });
    window.addEventListener('keydown', unlockOverlayAudio);
    window.addEventListener('touchstart', unlockOverlayAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOverlayAudio);
      window.removeEventListener('keydown', unlockOverlayAudio);
      window.removeEventListener('touchstart', unlockOverlayAudio);
    };
  }, [startOverlayAudio]);

  useEffect(() => {
    const requestId = activeState?.current?.requestId || null;
    const item = activeState?.current?.item;
    if (!item || !requestId) {
      currentRequestIdRef.current = null;
      videoRef.current?.pause();
      if (videoRef.current) {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      if (iframeRef.current) iframeRef.current.removeAttribute('src');
      setMediaStatus('Waiting for media');
      return;
    }

    if (currentRequestIdRef.current === `${activeBundle.sessionId}:${requestId}:${currentPlaybackUrl}`) {
      applyPlaybackState(activeState);
      return;
    }

    currentRequestIdRef.current = `${activeBundle.sessionId}:${requestId}:${currentPlaybackUrl}`;
    embeddedCurrentTimeRef.current = 0;
    lastEmbeddedPlaybackKeyRef.current = '';

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    setMediaStatus(`Loading ${item.title || 'media'}`);

    if (embeddedMode) {
      if (iframeRef.current) iframeRef.current.src = iframeUrlFor(currentPlaybackUrl);
      window.setTimeout(() => {
        registerYouTubeListeners();
        applyPlaybackState(activeState);
      }, 600);
      return;
    }

    if (!video || !currentPlaybackUrl) return;

    if (isHlsPlaybackUrl(currentPlaybackUrl)) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (!videoRef.current || currentRequestIdRef.current !== `${activeBundle.sessionId}:${requestId}:${currentPlaybackUrl}`) return;
          if (Hls.isSupported()) {
            hlsRef.current = new Hls({
              enableWorker: false,
              lowLatencyMode: false,
              backBufferLength: 30,
              manifestLoadingTimeOut: 60000,
              manifestLoadingMaxRetry: 4,
              manifestLoadingRetryDelay: 1000,
              manifestLoadingMaxRetryTimeout: 8000,
              fragLoadingTimeOut: 60000,
              fragLoadingMaxRetry: 4,
              fragLoadingRetryDelay: 1000,
              fragLoadingMaxRetryTimeout: 8000,
            });
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
              setMediaStatus('Overlay media ready');
              applyPlaybackState(activeState);
            });
            hlsRef.current.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
              const detail = data?.details || data?.type || 'HLS playback error';
              setMediaStatus(`Overlay HLS error: ${detail}`);
              console.error('[Overlay] HLS error', data);
            });
            hlsRef.current.loadSource(currentPlaybackUrl);
            hlsRef.current.attachMedia(videoRef.current);
            return;
          }

          if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = currentPlaybackUrl;
          } else {
            setMediaStatus('HLS is not supported in this browser');
          }
        })
        .catch((error) => {
          setMediaStatus('Failed to load HLS player');
          console.error('[Overlay] Failed to load HLS player', error);
        });
    } else {
      video.src = currentPlaybackUrl;
      video.load();
      applyVolume();
    }
  }, [
    activeBundle.sessionId,
    activeState?.current?.requestId,
    currentPlaybackUrl,
    embeddedMode,
    registerYouTubeListeners,
    applyPlaybackState,
    applyVolume,
    activeState,
  ]);

  useEffect(() => {
    applyPlaybackState(activeState);
  }, [activeState?.playback.status, activeState?.playback.position, activeState?.playback.updatedAt, applyPlaybackState, activeState]);

  useEffect(() => {
    applyVolume();
  }, [applyVolume, volume, isMuted]);

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
        setAudioReady(true);
        setMediaStatus('Overlay media playing');
      } else if (code === 2) {
        setMediaStatus('Overlay media paused');
      } else if (code === 0) {
        setMediaStatus('Overlay media ended');
      } else if (code === 3) {
        setMediaStatus('Overlay media buffering');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const hasPopout = (source: string) => popouts.some((p) => p.type === 'chat' && p.customSettings?.source === source);
  const hasQueue = popouts.some((p) => p.type === 'queue');
  const hasAddSong = popouts.some((p) => p.type === 'addSong');
  const hasWatch = popouts.some((p) => p.type === 'watch');
  const hasScreenShare = popouts.some((p) => p.type === 'screenShare');
  const togglePopout = (kind: 'chat' | 'queue' | 'addSong' | 'watch' | 'screenShare', source: string, size: { width: number; height: number }) => {
    const existing = popouts.find((p) => p.type === kind && (kind !== 'chat' || p.customSettings?.source === source));
    if (existing) closePopout(existing.id);
    else openPopout(kind, size, { source });
  };

  const mediaTitle = currentItem?.title || 'Waiting for media';
  const mediaSubtitle = currentItem?.artist || currentItem?.source || activeBundle.sessionId;
  const mediaImage = currentItem?.thumbnail || currentItem?.poster || currentItem?.image;
  const queueLength = activeState?.queue?.length || 0;
  const laneLabel = activeBundle.lane === 'music' ? 'Music Videos' : 'Watch Party';
  const musicQueue = musicState?.queue || [];

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-white">
      <div className="absolute inset-0 bg-transparent">
        {embeddedMode && currentPlaybackUrl && (
          <iframe
            ref={iframeRef}
            className="h-full w-full border-0 bg-black"
            title="Overlay media player"
            src={iframeUrlFor(currentPlaybackUrl)}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            onLoad={() => {
              registerYouTubeListeners();
              applyPlaybackState(activeState);
            }}
          />
        )}
        <video
          ref={videoRef}
          className={`h-full w-full bg-black object-contain ${embeddedMode ? 'hidden' : ''}`}
          muted={isMuted}
          playsInline
          onCanPlay={() => {
            setMediaStatus('Overlay media ready');
            applyPlaybackState(activeState);
          }}
          onPlaying={() => {
            setAudioReady(true);
            setMediaStatus('Overlay media playing');
          }}
          onPause={() => {
            if (!applyingRemoteState.current) setMediaStatus('Overlay media paused');
          }}
          onError={() => {
            const error = videoRef.current?.error;
            setMediaStatus(error ? `Overlay media error ${error.code}` : 'Overlay media error');
            console.error('[Overlay] media error', error);
          }}
        />
      </div>

      {showProfiles && (
        <div style={{ position: 'absolute', left: 20, top: 20 }}>
          <div className="min-w-[240px] max-w-[360px] rounded-lg bg-black/80 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
              <Users className="h-4 w-4" /> In the room ({activeProfiles.length})
            </div>
            {activeProfiles.length ? (
              <div className="flex flex-wrap gap-2">
                {activeProfiles.map((profile) => {
                  const name = profile.displayName || 'HearMeOut User';
                  return (
                    <div key={profile.id} className="flex max-w-[160px] items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={profile.photoURL} alt={name} />
                        <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate text-xs font-medium">{name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Waiting for room profiles…</p>
            )}
          </div>
        </div>
      )}

      {showNowPlaying && (
        <div style={{ position: 'absolute', left: 20, bottom: 20 }}>
          <div className="flex min-w-[320px] max-w-[520px] items-center gap-4 rounded-lg bg-black/80 p-4 shadow-2xl backdrop-blur-md">
            {mediaImage ? (
              <Image src={mediaImage} alt="" width={64} height={64} className="rounded-md object-cover" unoptimized />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-md bg-white/10">
                {activeBundle.lane === 'music' ? <Music className="h-8 w-8 text-white/80" /> : <Film className="h-8 w-8 text-white/80" />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">{laneLabel}</p>
              <h2 className="truncate text-lg font-bold">{mediaTitle}</h2>
              <p className="truncate text-sm text-gray-300">{mediaSubtitle}</p>
              <p className="truncate text-xs text-gray-400">{mediaStatus} · queue {queueLength}</p>
            </div>
            {connected && activeState?.playback.status === 'playing' && <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500" />}
          </div>
        </div>
      )}

      {showMusicQueue && (
        <div style={{ position: 'absolute', right: 20, bottom: 20 }}>
          <div className="w-[340px] max-w-[calc(100vw-40px)] rounded-lg bg-black/80 p-4 shadow-2xl backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                <ListMusic className="h-4 w-4" /> Music Queue
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">{musicQueue.length}</span>
            </div>
            {musicState?.current && (
              <div className="mb-2 rounded-md bg-emerald-500/15 p-2">
                <p className="text-[10px] font-semibold uppercase text-emerald-300">Now playing</p>
                <p className="truncate text-sm font-semibold">{musicState.current.item?.title || 'Untitled'}</p>
              </div>
            )}
            <div className="space-y-1.5">
              {musicQueue.slice(0, 5).map((request, index) => (
                <div key={request.requestId} className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5 text-xs">
                  <span className="w-5 shrink-0 text-center text-gray-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{request.item?.title || 'Untitled'}</span>
                  {request.requestedBy?.username && <span className="max-w-[90px] truncate text-gray-400">{request.requestedBy.username}</span>}
                </div>
              ))}
              {!musicQueue.length && <p className="py-2 text-center text-xs text-gray-400">The music queue is empty.</p>}
              {musicQueue.length > 5 && <p className="text-right text-[11px] text-gray-400">+{musicQueue.length - 5} more</p>}
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', right: 20, top: 20 }} className="opacity-20 transition-opacity hover:opacity-100">
        <div className="flex items-center gap-2 rounded-lg bg-black/80 p-3 shadow-2xl backdrop-blur-md">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                aria-label="Start overlay audio"
                onClick={() => startOverlayAudio().catch((error) => console.warn('[Overlay] start audio failed:', error))}
              >
                <Play className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{audioReady ? 'Overlay audio ready' : 'Start overlay audio'}</p></TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" aria-label="Overlay widgets">
                <Music className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Overlay Widgets</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={showNowPlaying} onCheckedChange={(checked) => setShowNowPlaying(checked === true)}>
                Now Playing
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showMusicQueue} onCheckedChange={(checked) => setShowMusicQueue(checked === true)}>
                Music Queue HUD
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showProfiles} onCheckedChange={(checked) => setShowProfiles(checked === true)}>
                Room Profiles
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={hasPopout('space')}
                onCheckedChange={() => togglePopout('chat', 'space', { width: 440, height: 620 })}
              >
                Space Mountain Chat
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hasPopout('discord')}
                onCheckedChange={() => togglePopout('chat', 'discord', { width: 520, height: 680 })}
              >
                Discord Chat
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hasPopout('twitch')}
                onCheckedChange={() => togglePopout('chat', 'twitch', { width: 440, height: 620 })}
              >
                Twitch Chat
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={hasQueue}
                onCheckedChange={() => togglePopout('queue', 'queue', { width: 760, height: 720 })}
              >
                Queue
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hasAddSong}
                onCheckedChange={() => {
                  const existing = popouts.find((p) => p.type === 'addSong');
                  if (existing) closePopout(existing.id);
                  else openPopout('addSong', { width: 460, height: 560 }, { source: 'addSong', sessionScope: 'overlay', roomId });
                }}
              >
                Add Song
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hasWatch}
                onCheckedChange={() => {
                  const existing = popouts.find((p) => p.type === 'watch');
                  if (existing) closePopout(existing.id);
                  else openPopout('watch', { width: 760, height: 620 }, { source: 'watch', sessionScope: 'overlay', roomId });
                }}
              >
                Watch Party
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={hasScreenShare}
                onCheckedChange={() => togglePopout('screenShare', 'screenShare', { width: 720, height: 520 })}
              >
                Screen Share
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={lane === 'music'}
                onCheckedChange={() => { window.location.search = '?media=music'; }}
              >
                Lock to Music
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={lane === 'movie'}
                onCheckedChange={() => { window.location.search = '?media=movie'; }}
              >
                Lock to Movies
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={lane === 'auto'}
                onCheckedChange={() => { window.location.search = '?media=auto'; }}
              >
                Auto Media Lane
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {currentItem?.type === 'music' && hasMusicModeToggle(currentItem) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-white hover:bg-white/20"
                  onClick={() => {
                    setMusicPlaybackMode((current) => current === 'audio' ? 'video' : 'audio');
                    currentRequestIdRef.current = null;
                  }}
                >
                  {musicPlaybackMode === 'audio' ? 'Audio' : 'Video'}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Switch music playback mode</p></TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                aria-label={isMuted ? 'Unmute overlay media' : 'Mute overlay media'}
                onClick={() => {
                  const nextMuted = !isMuted;
                  mutedRef.current = nextMuted;
                  setIsMuted(nextMuted);
                }}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{isMuted ? 'Unmute overlay media' : 'Mute overlay media'}</p></TooltipContent>
          </Tooltip>
          <Slider
            value={[isMuted ? 0 : volume]}
            onValueChange={(nextValue) => {
              const nextVolume = nextValue[0];
              volumeRef.current = nextVolume;
              setVolume(nextVolume);
              if (isMuted) {
                mutedRef.current = false;
                setIsMuted(false);
              }
            }}
            max={1}
            step={0.05}
            className="w-24"
          />
        </div>
      </div>
    </div>
  );
}
