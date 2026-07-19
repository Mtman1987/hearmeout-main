import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { getDefaultActivitySessionId } from '@/lib/watch/watch-request-service';

export function js(clientId: string, sessionId: string, appBaseUrlOverride?: string) {
  const appBaseUrl = appBaseUrlOverride || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hearmeout-main.fly.dev';
  return `
const CLIENT_ID = ${JSON.stringify(clientId)};
const GLOBAL_SESSION_ID = ${JSON.stringify(sessionId)};
const APP_BASE_URL = ${JSON.stringify(appBaseUrl.replace(/\/$/, ''))};
const MOVIE_SESSION_ID = 'discord-watch-room';
const MUSIC_SESSION_ID = 'discord-music-room';
const params = new URLSearchParams(location.search);
const IS_DISCORD_ACTIVITY = Boolean(params.get('frame_id')) || location.hostname.endsWith('.discordsays.com');
function cleanScopePart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
function normalizeSessionAlias(value, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const discordScopedMatch = raw.match(/^watch-discord-[a-z0-9_]+-[a-z0-9_]+-(movie|music)$/);
  if (discordScopedMatch) return discordScopedMatch[1] === 'music' ? MUSIC_SESSION_ID : MOVIE_SESSION_ID;
  if (raw === 'discord-watch-room' || raw === 'discord-music-room' || raw.startsWith('watch-')) return cleanScopePart(raw) || fallback;
  if (['watch', 'movie', 'movies', 'video', 'videos', 'main', 'default', 'global'].includes(raw)) return 'discord-watch-room';
  if (['music', 'song', 'songs', 'radio', 'dj'].includes(raw)) return 'discord-music-room';
  const clean = cleanScopePart(raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));
  return clean ? 'watch-' + clean : fallback;
}
function pairedSessionIds(value) {
  const raw = String(value || '');
  const roomMatch = raw.match(/^watch-room-(.+)-(movie|music)$/);
  if (roomMatch) {
    return {
      movie: 'watch-room-' + roomMatch[1] + '-movie',
      music: 'watch-room-' + roomMatch[1] + '-music',
    };
  }
  return { movie: MOVIE_SESSION_ID, music: MUSIC_SESSION_ID };
}
let sessionId = normalizeSessionAlias(params.get('sessionId') || params.get('session_id') || '', GLOBAL_SESSION_ID);
const video = document.getElementById('video');
const youtube = document.getElementById('youtube');
const audio = document.getElementById('audio');
const empty = document.getElementById('empty');
const statusEl = document.getElementById('activity-status');
const titleEl = document.getElementById('title');
const mediaEl = document.getElementById('media');
const queueEl = document.getElementById('queue');
const eventsEl = document.getElementById('events');
const errorEl = document.getElementById('error');
const drawerEl = document.getElementById('drawer');
const fullscreenBtn = document.getElementById('fullscreen');
const popoutBtn = document.getElementById('popout');
const downloadLink = document.getElementById('download');
const mediaModeBtn = document.getElementById('media-mode');
const visualTestBtn = document.getElementById('visual-test');
const ttsToggleBtn = document.getElementById('tts-toggle');
const muteBtn = document.getElementById('mute');
const volumeInput = document.getElementById('volume');
const volumeLabel = document.getElementById('volume-label');
const seekInput = document.getElementById('seek');
const positionLabel = document.getElementById('position-label');
const requestForm = document.getElementById('request-form');
const queryInput = document.getElementById('query');
const acceptRecommendationBtn = document.getElementById('accept-recommendation');
const sessionSwitchButtons = Array.from(document.querySelectorAll('[data-session-switch]'));
const VISUAL_TESTS = [
  { itemId: 'bbb', label: 'Big Buck Bunny MP4' },
  { itemId: 'sintel', label: 'Sintel HLS' },
  { itemId: 'tears-of-steel', label: 'Tears of Steel HLS' },
];
const YOUTUBE_CLIENT_RESOLVE_WAIT_MS = 9000;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
// Prefer clients that return plain, unciphered direct URLs (ANDROID_VR, then
// IOS); WEB is a last resort since its formats are usually signature-ciphered.
const INNERTUBE_CLIENTS = [
  { name: 'ANDROID_VR', context: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', gl: 'US' } },
  { name: 'IOS', context: { clientName: 'IOS', clientVersion: '19.45.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83', hl: 'en', gl: 'US' } },
  { name: 'WEB', context: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } },
];
let state = null;
let currentRequestId = null;
let hls = null;
let youtubeHlsFallbackTimer = null;
const youtubeNativeRetryCounts = {};
let applying = false;
let lastSeekApplyAt = 0;
let lastNativePlaybackAuthorityKey = '';
let mediaIsBuffering = false;
let muted = true;
let currentDownloadUrl = '';
let pendingRecommendation = null;
let pendingPlay = false;
let syncingCompletedPlayback = false;
let syncingNativeControl = false;
let lastNativePlayAt = 0;
let media = video;
let embeddedMode = false;
let lastEmbeddedPlaybackKey = '';
let embeddedCurrentTime = 0;
let lastEmbeddedNativeSyncAt = 0;
let musicPlaybackMode = 'video';
let activeMediaErrorKey = '';
const mediaErrorCounts = {};
const prematureEndRecoveryCounts = {};
const MEDIA_ERROR_FALLBACK_THRESHOLD = 1;
let ttsEnabled = false;
let ttsAudio = null;
let ttsPlaying = false;
let seekingLocally = false;
const ttsQueue = [];
const seenTtsIds = new Set();

try {
  ttsEnabled = localStorage.getItem('hmo_activity_tts_overlay') === '1';
  JSON.parse(localStorage.getItem('hmo_activity_tts_seen') || '[]').forEach((id) => seenTtsIds.add(String(id)));
} catch {}

function saveSeenTtsIds() {
  try {
    localStorage.setItem('hmo_activity_tts_seen', JSON.stringify(Array.from(seenTtsIds).slice(-200)));
  } catch {}
}

function updateTtsToggle() {
  if (!ttsToggleBtn) return;
  ttsToggleBtn.textContent = ttsEnabled ? 'TTS On' : 'TTS Off';
  ttsToggleBtn.classList.toggle('active', ttsEnabled);
}

function playNextTts() {
  if (!ttsEnabled || ttsPlaying || !ttsQueue.length) return;
  const request = ttsQueue.shift();
  const audioUrl = request && request.item && request.item.playbackUrl;
  if (!audioUrl) {
    playNextTts();
    return;
  }
  ttsPlaying = true;
  ttsAudio = new Audio(appUrl(audioUrl));
  ttsAudio.volume = Math.max(0.15, Number(volumeInput.value || 85) / 100);
  ttsAudio.addEventListener('ended', () => {
    ttsPlaying = false;
    playNextTts();
  }, { once: true });
  ttsAudio.addEventListener('error', () => {
    ttsPlaying = false;
    playNextTts();
  }, { once: true });
  ttsAudio.play().catch((err) => {
    ttsPlaying = false;
    errorEl.textContent = 'TTS blocked until you click in the Activity.';
    console.warn('TTS overlay blocked', err);
  });
}

function handleTtsOverlay(nextState) {
  const incoming = Array.isArray(nextState && nextState.ttsQueue) ? nextState.ttsQueue : [];
  incoming.forEach((request) => {
    const id = String(request && request.requestId || '');
    if (!id || seenTtsIds.has(id)) return;
    seenTtsIds.add(id);
    if (ttsEnabled) ttsQueue.push(request);
  });
  if (seenTtsIds.size > 220) {
    const ids = Array.from(seenTtsIds).slice(-200);
    seenTtsIds.clear();
    ids.forEach((id) => seenTtsIds.add(id));
  }
  saveSeenTtsIds();
  playNextTts();
}

function setActiveSessionTab() {
  const paired = pairedSessionIds(sessionId);
  sessionSwitchButtons.forEach((button) => {
    if (button.dataset.sessionKind === 'movie') button.dataset.sessionSwitch = paired.movie;
    if (button.dataset.sessionKind === 'music') button.dataset.sessionSwitch = paired.music;
    button.classList.toggle('active', button.dataset.sessionSwitch === sessionId);
  });
}

function isAudioOnlyItem(item) {
  const type = String((item && item.type) || '').toLowerCase();
  const provider = String((item && item.metadata && item.metadata.provider) || '').toLowerCase();
  const playbackUrl = String(playbackUrlForItem(item) || '').toLowerCase();
  return type === 'tts' || provider === 'tts' || (type === 'music' && playbackUrl.includes('/api/youtube-audio/'));
}

function isEmbeddedVideoItem(item) {
  const playbackUrl = String(playbackUrlForItem(item) || '').toLowerCase();
  return playbackUrl.includes('youtube.com/embed/') || playbackUrl.includes('youtube-nocookie.com/embed/');
}

function setActiveMediaForItem(item) {
  embeddedMode = isEmbeddedVideoItem(item);
  const nextMedia = isAudioOnlyItem(item) ? audio : video;
  media = nextMedia || video;
  video.classList.toggle('hidden', embeddedMode || media !== video);
  if (audio) audio.classList.toggle('hidden', media !== audio);
  if (youtube) youtube.classList.toggle('hidden', !embeddedMode);
}

function resetInactiveMedia() {
  if (embeddedMode) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    return;
  }
  if (youtube) youtube.removeAttribute('src');
  const inactive = media === video ? audio : video;
  if (!inactive) return;
  inactive.pause();
  inactive.removeAttribute('src');
  inactive.load();
}

function clearActiveMedia() {
  [video, audio].filter(Boolean).forEach((element) => {
    element.pause();
    element.removeAttribute('src');
    element.load();
  });
  if (youtube) youtube.removeAttribute('src');
  embeddedMode = false;
}

function musicModeOptions(item) {
  const metadata = (item && item.metadata) || {};
  return {
    video: metadata.videoPlaybackUrl || item?.playbackUrl || '',
    audio: metadata.audioPlaybackUrl || '',
  };
}

function hasMusicModeToggle(item) {
  const options = musicModeOptions(item);
  return item?.type === 'music' && Boolean(options.video && options.audio);
}

function preferredMusicPlaybackMode(item) {
  if (musicModeOptions(item).video) return 'video';
  if (musicModeOptions(item).audio) return 'audio';
  return item?.metadata?.playbackMode || 'video';
}

function isYoutubeAudioMusicItem(item) {
  return item?.type === 'music' && String(playbackUrlForItem(item) || '').toLowerCase().includes('/api/youtube-audio/');
}

function youtubeEmbedUrlForItem(item) {
  const videoId = item?.metadata?.videoId || String(item?.id || '').replace(/^youtube-/, '');
  return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) : '';
}

function youtubeVideoIdForItem(item) {
  const videoId = String(item?.metadata?.videoId || String(item?.id || '').replace(/^youtube-/, '') || '').trim();
  return YOUTUBE_VIDEO_ID_RE.test(videoId) ? videoId : '';
}

function shouldResolveYoutubeInBrowser(item) {
  return Boolean(youtubeVideoIdForItem(item) && item?.metadata?.playbackStrategy === 'proxy');
}

function reportActivityMedia(message, details) {
  if (!IS_DISCORD_ACTIVITY) return;
  fetch('/api/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area: 'discord-activity-media',
      message: message + (details ? ' | ' + details : ''),
      roomId: sessionId,
      identity: state?.current?.requestId || null,
      userAgent: navigator.userAgent,
    }),
  }).catch(() => {});
}

function pickBestYoutubeFormat(formats, type) {
  if (!Array.isArray(formats)) return null;
  const candidates = formats
    .filter((format) => {
      if (!format?.url) return false;
      const mime = String(format.mimeType || '');
      return type === 'video' ? mime.startsWith('video/') : mime.startsWith('audio/');
    })
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return candidates[0]?.url || null;
}

async function resolveYoutubeWithClient(videoId, client) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/player?key=' + encodeURIComponent(INNERTUBE_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId,
      context: { client: client.context },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!response.ok) throw new Error('YouTube API returned ' + response.status);
  const data = await response.json();
  if (data?.playabilityStatus?.status !== 'OK') {
    console.warn('[YT Resolve] ' + client.name + ' playability:', data?.playabilityStatus?.status, data?.playabilityStatus?.reason);
    return null;
  }
  const formats = [...(data?.streamingData?.formats || []), ...(data?.streamingData?.adaptiveFormats || [])];
  const videoUrl = pickBestYoutubeFormat(formats, 'video');
  const audioUrl = pickBestYoutubeFormat(formats, 'audio');
  if (!audioUrl) return null;
  return { videoUrl: videoUrl || audioUrl, audioUrl };
}

function getBrowserUserId() {
  try {
    let id = localStorage.getItem('hmo_user_id');
    if (!id) { id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('hmo_user_id', id); }
    return id;
  } catch { return ''; }
}

async function isAudioCached(videoId, userId) {
  try {
    const query = '?videoId=' + encodeURIComponent(videoId) + (userId ? '&user=' + encodeURIComponent(userId) : '');
    const data = await api('/api/watch/youtube/upload' + query);
    return Boolean(data && data.cached);
  } catch { return false; }
}

async function downloadAndCacheAudio(videoId, audioUrl, userId) {
  try {
    const download = await fetch(audioUrl);
    if (!download.ok) { console.warn('[YT Cache] download failed:', download.status); return false; }
    const blob = await download.blob();
    if (!blob.size) return false;
    const query = '?videoId=' + encodeURIComponent(videoId) + (userId ? '&user=' + encodeURIComponent(userId) : '');
    await api('/api/watch/youtube/upload' + query, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: blob });
    console.log('[YT Cache] Cached ' + videoId + ' on server (' + blob.size + ' bytes)');
    return true;
  } catch (err) { console.warn('[YT Cache] download/upload failed:', err); return false; }
}

async function resolveYoutubeInBrowser(videoId) {
  const userId = getBrowserUserId();
  // Favorites/most-played are already cached on the server.
  if (await isAudioCached(videoId, userId)) return { ok: true, reason: 'cached' };

  let timedOut = false;
  const lookup = (async () => {
    for (const client of INNERTUBE_CLIENTS) {
      try {
        const stream = await resolveYoutubeWithClient(videoId, client);
        if (stream) { console.log('[YT Resolve] Resolved ' + videoId + ' via ' + client.name); return stream; }
      } catch (err) {
        console.warn('[YT Resolve] ' + client.name + ' failed:', err);
      }
    }
    return null;
  })();
  const stream = await Promise.race([
    lookup.catch(() => null),
    new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, YOUTUBE_CLIENT_RESOLVE_WAIT_MS)),
  ]);
  if (!stream) return { ok: false, reason: timedOut ? 'timed out' : 'unavailable' };

  // Preferred: download the audio in this browser and upload it so the server
  // plays a cached file with no server-side extraction.
  const cached = await downloadAndCacheAudio(videoId, stream.audioUrl, userId);
  try {
    await api('/api/watch/youtube/resolve', {
      method: 'POST',
      body: JSON.stringify({ videoId, videoUrl: stream.videoUrl, audioUrl: stream.audioUrl }),
    });
  } catch {
    if (!cached) return { ok: false, reason: 'submit failed' };
  }
  return { ok: true, reason: cached ? 'cached' : 'submitted' };
}

function playbackUrlForItem(item) {
  if (hasMusicModeToggle(item)) {
    const options = musicModeOptions(item);
    return musicPlaybackMode === 'audio' ? options.audio : options.video;
  }
  return item?.playbackUrl || '';
}

function isBrowserLimitedVideo(item) {
  return String((item && item.overview) || '').toLowerCase().includes('(mkv)');
}

function hlsFallbackUrlForItem(item) {
  const playbackUrl = String(playbackUrlForItem(item) || '');
  const match = playbackUrl.match(/^\\/activity-provider\\/xtream\\/(vod|series)\\/(\\d+)$/i);
  const episodeMatch = playbackUrl.match(/^\\/activity-provider\\/xtream\\/episode\\/(\\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return '/api/watch/xtream/hls/episode-' + episodeMatch[1].toLowerCase() + '/index.m3u8';
  if (!match || !isBrowserLimitedVideo(item)) return playbackUrl;
  return '/api/watch/xtream/hls/' + match[1].toLowerCase() + '-' + match[2] + '/index.m3u8';
}

function isCurrentMediaActuallyEnded() {
  if (!state || !state.current) return false;
  if (embeddedMode) return false;
  const duration = Number(media.duration || 0);
  const currentTime = Number(media.currentTime || 0);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (media.readyState < 2) return false;
  return currentTime >= duration - 0.5;
}

function downloadUrlFor(url) {
  if (!url || !url.startsWith('/')) return url;
  const next = new URL(appUrl(url), window.location.href);
  next.searchParams.set('download', '1');
  return next.toString();
}

function downloadUrlForItem(item) {
  if (isEmbeddedVideoItem(item)) return '';
  const idMatch = String((item && item.id) || '').match(/^xtream-vod-(\\d+)$/i);
  if (idMatch) return '/activity-provider/xtream/vod/' + idMatch[1] + '?download=1';
  const episodeMatch = String((item && item.playbackUrl) || '').match(/^\\/activity-provider\\/xtream\\/episode\\/(\\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return '/activity-provider/xtream/episode/' + episodeMatch[1] + '?download=1';
  return downloadUrlFor((item && item.playbackUrl) || '');
}

function appUrl(path) {
  if (!path || /^https?:\\/\\//i.test(path)) return path;
  let nextPath = path.startsWith('/') ? path : '/' + path;
  const youtubeHlsMatch = nextPath.match(/^\\/api\\/watch\\/youtube\\/hls\\/([^/]+)\\/(index\\.m3u8)(?:\\?.*)?$/i);
  if (IS_DISCORD_ACTIVITY) {
    if (youtubeHlsMatch) {
      const params = new URLSearchParams({
        mediaVideoId: youtubeHlsMatch[1],
        // Discord's Electron build rejects the AAC MPEG-TS rendition even
        // after the proxy succeeds. Play the cached WebM/Opus source directly.
        mediaFile: 'source.webm',
      });
      return '/api/watch/sessions/' + encodeURIComponent(sessionId) + '/state?' + params.toString();
    }
    // Discord serves Activities from its own proxied origin. Keep API and media
    // requests relative so Discord's URL mapping carries them to HearMeOut;
    // absolute fly.dev URLs are blocked by the Activity sandbox.
    return nextPath;
  }
  if (youtubeHlsMatch) {
    nextPath = '/api/watch/youtube/hls/' + encodeURIComponent(youtubeHlsMatch[1]) + '/source.webm';
  }
  if (nextPath.startsWith('/api/watch/xtream/hls/')) nextPath = nextPath.replace('/api/watch/xtream/hls/', '/activity-provider/xtream/hls/');
  if (nextPath.startsWith('/api/watch/youtube/hls/')) nextPath = nextPath.replace('/api/watch/youtube/hls/', '/activity-provider/youtube/hls/');
  if (nextPath.startsWith('/activity/watch/xtream/hls/')) nextPath = nextPath.replace('/activity/watch/xtream/hls/', '/api/watch/xtream/hls/');
  if (nextPath.startsWith('/activity/watch/youtube/hls/')) nextPath = nextPath.replace('/activity/watch/youtube/hls/', '/api/watch/youtube/hls/');
  if (nextPath.startsWith('/activity/proxy')) nextPath = nextPath.replace('/activity/proxy', '/activity-proxy');
  if (APP_BASE_URL) {
    try {
      const base = new URL(APP_BASE_URL, window.location.href);
      if (base.origin && base.origin !== window.location.origin) return new URL(nextPath, base).toString();
    } catch {}
  }
  return nextPath;
}

function apiUrls(path) {
  const urls = [appUrl(path)];
  if (path && !/^https?:\\/\\//i.test(path) && APP_BASE_URL) {
    try {
      const base = new URL(APP_BASE_URL, window.location.href);
      urls.push(new URL(path.startsWith('/') ? path : '/' + path, base).toString());
    } catch {}
  }
  if (path && !/^https?:\\/\\//i.test(path)) urls.push(path.startsWith('/') ? path : '/' + path);
  return Array.from(new Set(urls.filter(Boolean)));
}

function iframeUrlFor(path) {
  const resolved = appUrl(path);
  if (!resolved || !isEmbeddedVideoItem({ playbackUrl: resolved, metadata: { provider: 'youtube' } })) return resolved;
  try {
    const url = new URL(resolved, window.location.href);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('controls', '0');
    return url.toString();
  } catch (err) {
    return resolved;
  }
}

function youtubeCommand(func, args) {
  if (!youtube || !youtube.contentWindow) return false;
  try {
    youtube.contentWindow.postMessage(JSON.stringify({
      event: 'command',
      func,
      args: args || [],
    }), '*');
    return true;
  } catch (err) {
    console.warn('YouTube command failed', func, err);
    return false;
  }
}

function registerYouTubeListeners() {
  if (!youtube || !youtube.contentWindow) return;
  try {
    youtube.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*');
  } catch (err) {
    console.warn('YouTube listener registration failed', err);
  }
}

function syncEmbeddedNativePlayback(action) {
  return;
}

function isHlsPlaybackUrl(value) {
  if (!value) return false;
  if (String(value).split('?')[0].endsWith('.m3u8')) return true;
  try {
    const parsed = new URL(appUrl(value), window.location.href);
    const proxied = parsed.searchParams.get('url');
    return Boolean(proxied && proxied.split('?')[0].endsWith('.m3u8'));
  } catch (err) {
    return false;
  }
}

function applyVolume() {
  const value = Math.max(0, Math.min(100, Number(volumeInput.value || 0)));
  const logical = value / 100;
  const isMusic = Boolean(state && state.current && state.current.item && state.current.item.type === 'music');
  const gain = isMusic && logical > 0 ? Math.pow(logical, 6) : logical;
  if (embeddedMode) {
    youtubeCommand('setVolume', [Math.round(gain * 100)]);
    youtubeCommand(muted || value === 0 ? 'mute' : 'unMute');
    muteBtn.textContent = muted || value === 0 ? '🔇' : '🔊';
    muteBtn.title = muted || value === 0 ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', muteBtn.title);
    volumeLabel.textContent = (muted ? 0 : value) + '%';
    return;
  }
  media.volume = gain;
  media.muted = muted || value === 0;
  muteBtn.textContent = media.muted ? '🔇' : '🔊';
  muteBtn.title = media.muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', muteBtn.title);
  volumeLabel.textContent = (media.muted ? 0 : value) + '%';
}

document.getElementById('room').textContent = 'Room ' + sessionId;
setActiveSessionTab();
statusEl.textContent = 'Connecting';

function discordHandshake() {
  const frameId = params.get('frame_id');
  if (!frameId || !CLIENT_ID) {
    statusEl.textContent = 'Browser test';
    return;
  }
  const target = window.parent;
  let origin = '*';
  try {
    if (document.referrer) origin = new URL(document.referrer).origin;
  } catch (err) {
    console.warn('Unable to parse Discord referrer', err);
  }
  window.addEventListener('message', (event) => {
    if (!Array.isArray(event.data)) return;
    const payload = event.data[1];
    if (payload && payload.evt === 'READY') statusEl.textContent = 'Discord connected';
  });
  try {
    target.postMessage([0, { v: 1, encoding: 'json', client_id: CLIENT_ID, frame_id: frameId, sdk_version: '2.5.0' }], origin);
  } catch (err) {
    statusEl.textContent = 'Browser mode';
    console.warn('Discord handshake skipped', err);
  }
  statusEl.textContent = 'Discord connecting';
}

async function api(path, options) {
  const requestOptions = options || {};
  const headers = { ...((requestOptions && requestOptions.headers) || {}) };
  if (requestOptions.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const urls = apiUrls(path);
  let lastError = null;
  for (const url of urls) {
    const response = await fetch(url, {
      ...requestOptions,
      cache: 'no-store',
      headers,
    });
    if (response.ok) return response.json();
    const payload = await response.json().catch(() => null);
    const error = new Error((payload && payload.error) || 'Request failed: ' + response.status);
    error.payload = payload;
    error.status = response.status;
    error.url = response.url || url;
    lastError = error;
    if (response.status !== 404) break;
  }
  throw lastError || new Error('Request failed');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function position(playback) {
  if (!playback) return 0;
  if (playback.status !== 'playing') return playback.position || 0;
  return (playback.position || 0) + (Date.now() - playback.updatedAt) / 1000;
}

function playbackSyncPolicy(item) {
  const isMusic = String((item && item.type) || '').toLowerCase() === 'music';
  return isMusic
    ? { deadband: 4, release: 2, slowRate: 0.98, fastRate: 1.02 }
    : { deadband: 8, release: 4, slowRate: 0.98, fastRate: 1.02 };
}

function driftPlaybackRate(signedDrift, item, currentRate) {
  const policy = playbackSyncPolicy(item);
  const correcting = Math.abs(Number(currentRate || 1) - 1) > 0.001;
  const threshold = correcting ? policy.release : policy.deadband;
  if (signedDrift > threshold) return policy.fastRate;
  if (signedDrift < -threshold) return policy.slowRate;
  return 1;
}

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function currentMediaDuration() {
  if (!state?.current || embeddedMode || (media !== video && media !== audio)) return 0;
  const duration = Number(media.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function updateSeekUi() {
  if (!seekInput || !positionLabel) return;
  const duration = currentMediaDuration();
  const currentPosition = state?.playback ? position(state.playback) : Number(media?.currentTime || 0);
  const canSeek = Boolean(state?.current && duration > 0);
  seekInput.disabled = !canSeek;
  seekInput.max = String(Math.max(1, Math.round(duration || 1)));
  if (!seekingLocally) seekInput.value = String(Math.max(0, Math.min(Number(seekInput.max || 1), Math.round(currentPosition || 0))));
  const labelPosition = seekingLocally ? Number(seekInput.value || 0) : currentPosition;
  positionLabel.textContent = formatClock(labelPosition) + ' / ' + (duration ? formatClock(duration) : '--:--');
}

function applyPlayback() {
  if (!state || !state.current) return;
  if (embeddedMode) {
    const remote = position(state.playback);
    const playbackKey = [
      state.current.requestId,
      state.playback.status,
      Math.round(Number(state.playback.position || 0)),
      Number(state.playback.updatedAt || 0),
    ].join(':');
    if (playbackKey !== lastEmbeddedPlaybackKey && Number.isFinite(remote)) {
      lastEmbeddedPlaybackKey = playbackKey;
      youtubeCommand('seekTo', [Math.max(0, remote), true]);
    }
    if (state.playback.status === 'playing') {
      youtubeCommand('playVideo');
      mediaEl.textContent = 'Media: embedded video playing';
    } else {
      youtubeCommand('pauseVideo');
      mediaEl.textContent = 'Media: embedded video paused';
    }
    applyVolume();
    updateSeekUi();
    return;
  }
  if (mediaIsBuffering || media.readyState < 2) {
    updateSeekUi();
    return;
  }
  const remote = position(state.playback);
  const drift = Math.abs((media.currentTime || 0) - remote);
  applying = true;
  const isLive = state.current.item.type === 'live' || state.current.item.runtime === 'live';
  const authorityKey = [
    state.current.requestId,
    state.playback.status,
    Number(state.playback.position || 0).toFixed(3),
    Number(state.playback.updatedAt || 0),
  ].join(':');
  const authorityChanged = authorityKey !== lastNativePlaybackAuthorityKey;
  lastNativePlaybackAuthorityKey = authorityKey;
  if (!isLive && Number.isFinite(media.duration) && media.duration > 0 && remote >= media.duration - 0.5) {
    media.playbackRate = 1;
    setTimeout(() => { applying = false; }, 100);
    return;
  }
  // A new item or an explicit shared control update is authoritative and may
  // seek once. Ordinary one-second polling must never repeatedly jump an HLS
  // movie forward when buffering or keyframe seeking leaves it behind the wall
  // clock. Normal drift is corrected gently with a wide hysteresis window.
  if (!isLive && authorityChanged && drift > 1.25 && Number.isFinite(remote)) {
    lastSeekApplyAt = Date.now();
    media.currentTime = Math.max(0, Math.min(remote, Math.max(0, media.duration - 1)));
  }
  if (!isLive && state.playback.status === 'playing' && !media.paused && !mediaIsBuffering && !authorityChanged) {
    const signedDrift = remote - Number(media.currentTime || 0);
    media.playbackRate = driftPlaybackRate(signedDrift, state.current.item, media.playbackRate);
  } else if (media.playbackRate !== 1) {
    media.playbackRate = 1;
  }
  const playSyncInFlight = syncingNativeControl && Date.now() - lastNativePlayAt < 5000;
  if (state.playback.status === 'paused' && !media.paused && !playSyncInFlight) media.pause();
  if (state.playback.status === 'playing' && media.paused && !pendingPlay) startVideoPlayback();
  updateSeekUi();
  setTimeout(() => { applying = false; }, 100);
}

function startVideoPlayback() {
  if (!state || !state.current) return Promise.resolve(false);
  if (embeddedMode) {
    pendingPlay = false;
    youtubeCommand('playVideo');
    applyVolume();
    mediaEl.textContent = 'Media: embedded video playing';
    return Promise.resolve(true);
  }
  pendingPlay = true;
  if (media.readyState < 2) {
    mediaEl.textContent = 'Media: loading';
    return Promise.resolve(false);
  }
  return media.play()
    .then(() => {
      pendingPlay = false;
      mediaEl.textContent = 'Media: playing';
      return true;
    })
    .catch((err) => {
      pendingPlay = false;
      mediaEl.textContent = 'Media: autoplay blocked; use Discord controls after opening Activity';
      console.warn(err);
      return false;
    });
}

function syncNativePlayback(action) {
  return;
}

function switchToYoutubeEmbedFallback(item, reason) {
  if (IS_DISCORD_ACTIVITY) {
    const retryKey = state?.current?.requestId || youtubeVideoIdForItem(item) || 'youtube';
    const attempts = (youtubeNativeRetryCounts[retryKey] || 0) + 1;
    youtubeNativeRetryCounts[retryKey] = attempts;
    if (youtubeHlsFallbackTimer) clearTimeout(youtubeHlsFallbackTimer);
    if (attempts > 40) {
      mediaEl.textContent = 'Media: Discord-native stream failed to prepare';
      errorEl.textContent = 'This source could not be prepared for Discord. Try Next or request another song.';
      reportActivityMedia('native stream failed', reason + ' after ' + attempts + ' attempts');
      return false;
    }
    mediaEl.textContent = 'Media: preparing Discord-native stream (' + attempts + ')';
    reportActivityMedia('native stream retry', reason + ' attempt=' + attempts);
    youtubeHlsFallbackTimer = setTimeout(() => {
      youtubeHlsFallbackTimer = null;
      if (state?.current?.requestId !== retryKey) return;
      loadMedia(item);
    }, 3000);
    return true;
  }
  const embedUrl = item?.metadata?.embedPlaybackUrl || youtubeEmbedUrlForItem(item);
  if (!embedUrl) return false;
  if (youtubeHlsFallbackTimer) {
    clearTimeout(youtubeHlsFallbackTimer);
    youtubeHlsFallbackTimer = null;
  }
  if (hls) {
    hls.destroy();
    hls = null;
  }
  const fallbackItem = {
    ...item,
    playbackUrl: embedUrl,
    metadata: {
      ...(item.metadata || {}),
      videoPlaybackUrl: embedUrl,
      playbackStrategy: 'embed',
    },
  };
  if (state?.current) state.current.item = fallbackItem;
  mediaEl.textContent = 'Media: ' + reason + '; using YouTube embed';
  loadMedia(fallbackItem);
  return true;
}

async function loadMedia(item) {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (youtubeHlsFallbackTimer) {
    clearTimeout(youtubeHlsFallbackTimer);
    youtubeHlsFallbackTimer = null;
  }
  setActiveMediaForItem(item);
  resetInactiveMedia();
  video.removeAttribute('src');
  if (audio) audio.removeAttribute('src');
  lastSeekApplyAt = 0;
  lastNativePlaybackAuthorityKey = '';
  lastEmbeddedPlaybackKey = '';
  embeddedCurrentTime = 0;
  lastEmbeddedNativeSyncAt = 0;
  activeMediaErrorKey = state?.current ? state.current.requestId + ':' + playbackUrlForItem(item) : '';
  if (activeMediaErrorKey) mediaErrorCounts[activeMediaErrorKey] = mediaErrorCounts[activeMediaErrorKey] || 0;
  mediaIsBuffering = true;
  pendingPlay = false;
  mediaEl.textContent = 'Media: loading ' + item.title;
  const loadingRequestId = state?.current?.requestId || '';
  if (shouldResolveYoutubeInBrowser(item) && !IS_DISCORD_ACTIVITY) {
    const videoId = youtubeVideoIdForItem(item);
    mediaEl.textContent = 'Media: resolving YouTube stream in this browser';
    const resolved = await resolveYoutubeInBrowser(videoId);
    if (state?.current?.requestId !== loadingRequestId) return;
    if (!resolved.ok) {
      switchToYoutubeEmbedFallback(item, 'browser stream ' + resolved.reason);
      return;
    }
    mediaEl.textContent = 'Media: browser stream resolved; preparing video';
  }
  const selectedPlaybackUrl = hlsFallbackUrlForItem(item);
  const playbackUrl = appUrl(selectedPlaybackUrl);
  if (embeddedMode) {
    if (youtube) {
      youtube.src = iframeUrlFor(playbackUrl);
      mediaIsBuffering = false;
      pendingPlay = false;
      mediaEl.textContent = 'Media: embedded video ready';
      setTimeout(() => {
        registerYouTubeListeners();
        applyVolume();
        if (state && state.playback && state.playback.status === 'playing') startVideoPlayback();
        else applyPlayback();
      }, 700);
    } else {
      mediaEl.textContent = 'Media: embedded player unavailable';
    }
  } else if (media === audio) {
    audio.src = playbackUrl;
    audio.load();
  } else if (isHlsPlaybackUrl(playbackUrl) && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({
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
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (youtubeHlsFallbackTimer) {
        clearTimeout(youtubeHlsFallbackTimer);
        youtubeHlsFallbackTimer = null;
      }
      mediaEl.textContent = 'Media: ready';
      if (state?.current?.requestId) youtubeNativeRetryCounts[state.current.requestId] = 0;
      reportActivityMedia('HLS manifest ready', item.title);
      mediaIsBuffering = false;
      if (state && state.playback && state.playback.status === 'playing') startVideoPlayback();
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      const details = data && (data.details || data.type || data.reason || data.response && data.response.code);
      mediaEl.textContent = data && data.fatal
        ? 'Media: HLS error' + (details ? ' - ' + details : '')
        : 'Media: buffering' + (details ? ' - ' + details : '');
      if (data && data.fatal) {
        console.warn('HLS fatal error', data);
        reportActivityMedia('HLS fatal error', String(details || 'unknown'));
        switchToYoutubeEmbedFallback(item, 'HLS failed');
      }
    });
    hls.loadSource(playbackUrl);
    hls.attachMedia(video);
    if (shouldResolveYoutubeInBrowser(item)) {
      youtubeHlsFallbackTimer = setTimeout(() => {
        if (state?.current?.requestId === loadingRequestId) switchToYoutubeEmbedFallback(item, 'HLS timed out');
      }, 15000);
    }
  } else {
    video.src = playbackUrl;
    video.load();
  }
  applyVolume();
}

function render(nextState) {
  state = nextState;
  handleTtsOverlay(state);
  if (state.playback && typeof state.playback.muted === 'boolean' && muted !== state.playback.muted) {
    muted = state.playback.muted;
    applyVolume();
  }
  if (state.playback && typeof state.playback.volume === 'number' && volumeInput) {
    const nextVolume = Math.max(0, Math.min(100, Math.round(Number(state.playback.volume || 0))));
    if (String(volumeInput.value) !== String(nextVolume)) {
      volumeInput.value = String(nextVolume);
      applyVolume();
    }
  }
  if (state.id && state.id !== sessionId) {
    sessionId = state.id;
    document.getElementById('room').textContent = 'Room ' + sessionId;
  }
  setActiveSessionTab();
  empty.classList.toggle('hidden', Boolean(state.current));
  empty.style.display = state.current ? 'none' : 'grid';
  popoutBtn.disabled = !state.current;
  if (mediaModeBtn) {
    const canToggleMode = Boolean(state.current && hasMusicModeToggle(state.current.item));
    mediaModeBtn.hidden = !canToggleMode;
    if (canToggleMode) mediaModeBtn.textContent = musicPlaybackMode === 'audio' ? 'Audio' : 'Video';
  }
  if (state.current) {
    titleEl.textContent = state.current.item.title + ' (' + state.current.item.year + ')';
    const url = downloadUrlForItem(state.current.item);
    if (url) {
      currentDownloadUrl = url;
      downloadLink.disabled = false;
    } else {
      currentDownloadUrl = '';
      downloadLink.disabled = true;
    }
    if (state.current.requestId !== currentRequestId) {
      currentRequestId = state.current.requestId;
      musicPlaybackMode = preferredMusicPlaybackMode(state.current.item);
      loadMedia(state.current.item);
    }
    applyPlayback();
  } else {
    titleEl.textContent = 'Waiting for a request';
    mediaEl.textContent = 'Media: idle';
    currentDownloadUrl = '';
    downloadLink.disabled = true;
    currentRequestId = null;
    clearActiveMedia();
  }
  const queueRows = [];
  if (state.current) {
    queueRows.push('<li><strong>Now playing:</strong> ' + escapeHtml(state.current.item.title) + '</li>');
  }
  if (state.queue.length) {
    queueRows.push(...state.queue.map((request, index) => '<li class="queue-item"><span class="queue-index">' + (index + 1) + '</span><strong>' + escapeHtml(request.item.title) + '</strong></li>'));
  }
  queueEl.innerHTML = queueRows.length ? queueRows.join('') : '<li>Queue is empty.</li>';
  eventsEl.innerHTML = state.events.length
    ? state.events.slice(0, 8).map((event) => '<li>' + new Date(event.at).toLocaleTimeString() + ' - ' + escapeHtml(event.message) + '</li>').join('')
    : '<li>No events yet.</li>';
  updateSeekUi();
}

function setPendingRecommendation(recommendation) {
  pendingRecommendation = recommendation || null;
  if (!acceptRecommendationBtn) return;
  if (pendingRecommendation) {
    acceptRecommendationBtn.style.display = 'block';
    acceptRecommendationBtn.disabled = false;
    acceptRecommendationBtn.textContent = 'Add "' + pendingRecommendation.title + '"';
  } else {
    acceptRecommendationBtn.style.display = 'none';
    acceptRecommendationBtn.disabled = true;
    acceptRecommendationBtn.textContent = 'Add Recommended Match';
  }
}

function setDrawer(panelName) {
  const active = drawerEl.classList.contains('open') && drawerEl.dataset.panel === panelName;
  drawerEl.classList.toggle('open', !active);
  drawerEl.dataset.panel = active ? '' : panelName;
  document.querySelectorAll('[data-panel-section]').forEach((section) => {
    section.classList.toggle('active', !active && section.dataset.panelSection === panelName);
  });
  document.querySelectorAll('[data-panel]').forEach((button) => {
    button.classList.toggle('active', !active && button.dataset.panel === panelName);
  });
  document.body.classList.remove('focus-mode');
}

async function refresh() {
  try {
    render(await api('/api/watch/sessions/' + sessionId + '/state'));
    if (statusEl.textContent !== 'Discord connected') statusEl.textContent = 'Live';
    errorEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Disconnected';
    errorEl.textContent = err && err.message ? err.message : String(err);
    console.error(err);
  }
}

async function control(action, positionOverride) {
  const body = {
    action,
    position: Number.isFinite(positionOverride)
      ? positionOverride
      : embeddedMode
        ? position(state && state.playback)
        : (media.currentTime || 0),
  };
  try {
    const expectedRequestId = action === 'next' && state && state.current ? state.current.requestId : '';
    const controlUrl = '/api/watch/sessions/' + sessionId + '/quick-control?action=' + encodeURIComponent(action) + '&position=' + encodeURIComponent(String(body.position || 0)) + '&expectedRequestId=' + encodeURIComponent(expectedRequestId) + '&format=json&platform=activity&isHost=true';
    const result = await api(controlUrl);
    render(result.session);
    if (action === 'seek') mediaEl.textContent = 'Media: synced at ' + Math.round(body.position) + 's';
    if (action === 'next') mediaEl.textContent = state && state.current ? 'Media: loaded next' : 'Media: queue ended';
    if (action === 'clear') mediaEl.textContent = 'Media: queue cleared';
    errorEl.textContent = '';
  } catch (err) {
    errorEl.textContent = err && err.message ? err.message : String(err);
    throw err;
  }
}

function handleAction(action) {
  if (action === 'play-pause') {
    const nextAction = state && state.playback && state.playback.status === 'playing' ? 'pause' : 'play';
    control(nextAction).catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
    return;
  }
  if (action === 'sync-local') {
    applyPlayback();
    mediaEl.textContent = 'Media: synced to live position';
    return;
  }
  if (action === 'next') {
    control('next').catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
    return;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestVisualTestItem(test) {
  const result = await api('/api/watch/sessions/' + sessionId + '/request', {
    method: 'POST',
    body: JSON.stringify({
      itemId: test.itemId,
      username: 'activity visual test',
      userId: 'activity-visual-test',
      platform: 'activity',
      announceDiscord: false,
    }),
  });
  render(result.session);
  return result.session;
}

function sampleVideoFrame() {
  if (!state?.current) return { ok: false, reason: 'no current item' };
  if (embeddedMode || media !== video) return { ok: false, reason: 'not native video' };
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return { ok: false, reason: 'video not ready', readyState: video.readyState };
  }

  const width = 64;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { ok: false, reason: 'canvas unavailable' };

  try {
    context.drawImage(video, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    let bright = 0;
    let sum = 0;
    let sumSq = 0;
    let samples = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += luminance;
      sumSq += luminance * luminance;
      if (luminance > 12) bright += 1;
      samples += 1;
    }
    const average = samples ? sum / samples : 0;
    const variance = samples ? (sumSq / samples) - (average * average) : 0;
    const brightRatio = samples ? bright / samples : 0;
    return {
      ok: brightRatio > 0.02 && (average > 8 || variance > 8),
      reason: 'frame still dark',
      average,
      variance,
      brightRatio,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'canvas blocked: ' + (err && err.message ? err.message : String(err)),
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  }
}

async function waitForVisibleNativeFrame(label, timeoutMs) {
  const startedAt = Date.now();
  let playRequested = false;
  let lastSample = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (!playRequested) {
      playRequested = true;
      await control('play', 0).catch(() => null);
      pendingPlay = true;
      startVideoPlayback();
    }
    await sleep(500);
    applyPlayback();
    lastSample = sampleVideoFrame();
    if (lastSample.ok) return { ok: true, detail: lastSample };
    mediaEl.textContent = 'Visual test: checking ' + label + ' (' + (lastSample.reason || 'waiting') + ')';
  }
  return { ok: false, detail: lastSample };
}

async function runVisualTest() {
  if (!visualTestBtn) return;
  visualTestBtn.disabled = true;
  const originalLabel = visualTestBtn.textContent || 'Visual Test';
  try {
    errorEl.textContent = '';
    visualTestBtn.textContent = 'Testing...';
    await switchSession(MOVIE_SESSION_ID);
    setDrawer('queue');
    for (const test of VISUAL_TESTS) {
      mediaEl.textContent = 'Visual test: loading ' + test.label;
      await control('clear', 0).catch(() => null);
      await requestVisualTestItem(test);
      const result = await waitForVisibleNativeFrame(test.label, 9000);
      if (result.ok) {
        const detail = result.detail || {};
        mediaEl.textContent = 'Visual test passed: ' + test.label;
        errorEl.textContent = 'Native frame detected in Activity video' + (detail.width && detail.height ? ' at ' + detail.width + 'x' + detail.height : '') + '.';
        return;
      }
      errorEl.textContent = 'Visual test failed for ' + test.label + ': ' + ((result.detail && result.detail.reason) || 'no visible frame');
    }
    mediaEl.textContent = 'Visual test failed';
    errorEl.textContent = 'No native test source produced a measurable frame in this Activity instance.';
  } catch (err) {
    errorEl.textContent = err && err.message ? err.message : String(err);
  } finally {
    visualTestBtn.disabled = false;
    visualTestBtn.textContent = originalLabel;
  }
}

document.querySelectorAll('[data-panel]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    setDrawer(button.dataset.panel);
  });
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (button.disabled) return;
    handleAction(button.dataset.action);
  });
});

if (visualTestBtn) {
  visualTestBtn.addEventListener('click', (event) => {
    event.preventDefault();
    runVisualTest();
  });
}

fullscreenBtn.addEventListener('click', () => {
  const focusMode = !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', focusMode);
  fullscreenBtn.classList.toggle('active', focusMode);
  fullscreenBtn.title = focusMode ? 'Show panels' : 'Focus video';
  fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  drawerEl.classList.remove('open');
  document.querySelectorAll('[data-panel], [data-panel-section]').forEach((element) => element.classList.remove('active'));
  if (!focusMode || !state || !state.current) return;
  const target = document.querySelector('.video-wrap') || video;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (target.requestFullscreen) {
    target.requestFullscreen().catch((err) => {
      errorEl.textContent = err && err.message ? err.message : 'Fullscreen was blocked';
      if (String(errorEl.textContent || '').toLowerCase().includes('permission')) {
        errorEl.textContent = 'Discord blocked fullscreen for this iframe. Try the native video fullscreen control or Pop Out.';
      }
      console.warn(err);
    });
  } else if (video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  } else {
    errorEl.textContent = 'The video is focused inside Discord. Browser fullscreen is not available in this frame.';
  }
});

popoutBtn.addEventListener('click', () => {
  if (!state || !state.current || !state.current.item.playbackUrl) {
    errorEl.textContent = 'No media is available to pop out yet.';
    return;
  }
  const popupUrl = '/watch/' + encodeURIComponent(sessionId) + '?canPause=1';
  const popup = window.open(popupUrl, 'watch-popout-' + sessionId, 'popup=yes,width=1100,height=680');
  if (!popup) {
    errorEl.textContent = 'Discord blocked the popout window.';
    return;
  }
  popup.focus();
  errorEl.textContent = '';
});

downloadLink.addEventListener('click', () => {
  if (!currentDownloadUrl) {
    errorEl.textContent = 'No media is available to download yet.';
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = currentDownloadUrl;
  anchor.download = state && state.current ? (state.current.item.title || 'watch-media') : 'watch-media';
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  errorEl.textContent = 'If Discord blocks the download, use Pop Out and the native video menu.';
});

muteBtn.addEventListener('click', () => {
  muted = !muted;
  applyVolume();
  mediaEl.textContent = muted ? 'Media: muted locally' : 'Media: unmuted locally';
  control(muted ? 'mute' : 'unmute').catch((err) => {
    errorEl.textContent = err && err.message ? err.message : String(err);
  });
});

async function switchSession(nextSessionId) {
  const normalized = normalizeSessionAlias(nextSessionId, sessionId || GLOBAL_SESSION_ID);
  if (!normalized || normalized === sessionId) return;
  sessionId = normalized;
  currentRequestId = null;
  pendingPlay = false;
  setPendingRecommendation(null);
  clearActiveMedia();
  document.getElementById('room').textContent = 'Room ' + sessionId;
  setActiveSessionTab();
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('sessionId', sessionId);
    window.history.replaceState({}, '', nextUrl.toString());
  } catch {}
  mediaEl.textContent = sessionId === MUSIC_SESSION_ID ? 'Media: music room' : 'Media: movie room';
  await refresh();
  setDrawer('request');
  queryInput.focus();
}

sessionSwitchButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    switchSession(button.dataset.sessionSwitch).catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
  });
});

if (mediaModeBtn) {
  mediaModeBtn.addEventListener('click', () => {
    if (!state?.current || !hasMusicModeToggle(state.current.item)) return;
    const wasPlaying = state.playback?.status === 'playing';
    musicPlaybackMode = musicPlaybackMode === 'audio' ? 'video' : 'audio';
    mediaModeBtn.textContent = musicPlaybackMode === 'audio' ? 'Audio' : 'Video';
    const positionBeforeSwap = embeddedMode ? position(state.playback) : (media.currentTime || position(state.playback));
    loadMedia(state.current.item);
    if (Number.isFinite(positionBeforeSwap) && positionBeforeSwap > 0) {
      media.currentTime = positionBeforeSwap;
    }
    if (wasPlaying) {
      pendingPlay = true;
      setTimeout(() => startVideoPlayback(), 250);
    }
  });
}

if (ttsToggleBtn) {
  updateTtsToggle();
  ttsToggleBtn.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    try {
      localStorage.setItem('hmo_activity_tts_overlay', ttsEnabled ? '1' : '0');
    } catch {}
    updateTtsToggle();
    if (ttsEnabled) playNextTts();
  });
}

volumeInput.addEventListener('input', () => {
  const shouldUnmute = Number(volumeInput.value || 0) > 0 && muted;
  if (shouldUnmute) muted = false;
  applyVolume();
  mediaEl.textContent = 'Media: volume ' + volumeLabel.textContent;
  if (shouldUnmute) {
    control('unmute').catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
  }
});

if (seekInput) {
  seekInput.addEventListener('input', () => {
    seekingLocally = true;
    updateSeekUi();
  });
  seekInput.addEventListener('change', () => {
    const nextPosition = Number(seekInput.value || 0);
    seekingLocally = false;
    control('seek', nextPosition).catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
  });
}

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  setPendingRecommendation(null);
  const query = queryInput.value.trim();
  if (!query) return;
  try {
    const isMusicSession = sessionId === MUSIC_SESSION_ID || String(sessionId || '').toLowerCase().includes('music');
    const requestUrl = '/api/watch/sessions/' + sessionId + '/request?query=' + encodeURIComponent(query) + '&username=' + encodeURIComponent('activity tester') + '&userId=activity&platform=activity&announceDiscord=1' + (isMusicSession ? '&mediaType=music' : '');
    const result = await api(requestUrl);
    if (result && result.success === false) {
      if (result.recommendation) {
        setPendingRecommendation(result.recommendation);
        mediaEl.textContent = 'Media: recommendation ready';
        errorEl.textContent = 'No direct playable match. Use Add Recommended Match.';
        return;
      }
      errorEl.textContent = result.error || 'No playable match found.';
      return;
    }
    queryInput.value = '';
    render(result.session);
    setDrawer('queue');
    mediaEl.textContent = result.session && result.session.current ? 'Media: added to watch room' : 'Media: queued';
  } catch (err) {
    if (err.payload && err.payload.recommendation) {
      setPendingRecommendation(err.payload.recommendation);
    }
    errorEl.textContent = err.message;
  }
});

acceptRecommendationBtn.addEventListener('click', async () => {
  if (!pendingRecommendation) return;
  errorEl.textContent = '';
  try {
    const result = await api('/api/watch/sessions/' + sessionId + '/accept', {
      method: 'POST',
      body: JSON.stringify({ username: 'activity tester', userId: 'activity', platform: 'activity' }),
    });
    if (result && result.success === false) {
      errorEl.textContent = result.error || 'No pending recommendation';
      return;
    }
    setPendingRecommendation(null);
    render(result.session);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function onMediaPlay(event) {
  if (event.currentTarget !== media) return;
  if (state && state.playback && state.playback.status !== 'playing') syncNativePlayback('play');
}
function onMediaPlaying(event) {
  if (event.currentTarget !== media) return;
  mediaEl.textContent = 'Media: playing';
  reportActivityMedia('native media playing', state?.current?.item?.title || 'unknown');
}
function onMediaCanPlay(event) {
  if (event.currentTarget !== media) return;
  mediaIsBuffering = false;
  if (activeMediaErrorKey) mediaErrorCounts[activeMediaErrorKey] = 0;
  mediaEl.textContent = 'Media: ready';
  if (pendingPlay || (state && state.playback && state.playback.status === 'playing')) startVideoPlayback();
}
function onMediaWaiting(event) { if (event.currentTarget === media) { mediaIsBuffering = true; mediaEl.textContent = 'Media: buffering'; } }
function onMediaLoadedData(event) {
  if (event.currentTarget !== media) return;
  mediaIsBuffering = false;
  if (pendingPlay || (state && state.playback && state.playback.status === 'playing')) startVideoPlayback();
}
function onMediaPause(event) {
  if (event.currentTarget !== media) return;
  if (!media.ended) {
    mediaEl.textContent = 'Media: paused';
  }
}
function onMediaSeeked(event) { if (event.currentTarget === media && !applying && state && state.current) mediaEl.textContent = 'Media: sync will restore live position'; }
function onMediaEnded(event) {
  if (event.currentTarget !== media) return;
  const requestId = state?.current?.requestId;
  const duration = Number(media.duration || 0);
  const remote = state?.playback ? position(state.playback) : 0;
  const endedBeforeSharedTimeline = Boolean(
    requestId
    && state?.playback?.status === 'playing'
    && Number.isFinite(duration)
    && duration > 0
    && Number.isFinite(remote)
    && remote < duration - 3
  );
  if (endedBeforeSharedTimeline) {
    const attempts = (prematureEndRecoveryCounts[requestId] || 0) + 1;
    prematureEndRecoveryCounts[requestId] = attempts;
    mediaEl.textContent = 'Media: recovering from an early stream end';
    reportActivityMedia('premature media end', 'remote=' + remote.toFixed(1) + ' duration=' + duration.toFixed(1) + ' attempt=' + attempts);
    if (attempts <= 3) {
      setTimeout(() => {
        if (state?.current?.requestId !== requestId) return;
        loadMedia(state.current.item);
      }, 750);
    } else {
      errorEl.textContent = 'The media source ended early. The shared queue was preserved; press Play to retry.';
    }
    return;
  }
  mediaEl.textContent = 'Media: ended';
  control('next', 0).catch((err) => {
    errorEl.textContent = err && err.message ? err.message : String(err);
  });
}
function onMediaError(event) {
  if (event.currentTarget !== media) return;
  const item = state?.current?.item;
  const errorKey = activeMediaErrorKey || (state?.current ? state.current.requestId + ':' + playbackUrlForItem(item) : '');
  const attempts = (mediaErrorCounts[errorKey] || 0) + 1;
  mediaErrorCounts[errorKey] = attempts;
  reportActivityMedia('native media element error', String(media.error?.code || 'unknown') + ' attempt=' + attempts);
  if (isYoutubeAudioMusicItem(item) && attempts < MEDIA_ERROR_FALLBACK_THRESHOLD) {
    mediaEl.textContent = 'Media: retrying audio stream ' + attempts + '/' + MEDIA_ERROR_FALLBACK_THRESHOLD;
    setTimeout(() => {
      if (!state?.current || activeMediaErrorKey !== errorKey) return;
      media.load();
      if (state.playback?.status === 'playing') startVideoPlayback();
    }, 750);
  } else if (isYoutubeAudioMusicItem(item)) {
    const embedUrl = youtubeEmbedUrlForItem(item);
    if (embedUrl) {
      mediaEl.textContent = 'Media: switching to YouTube embed fallback';
      const fallbackItem = {
        ...item,
        playbackUrl: embedUrl,
        metadata: {
          ...(item.metadata || {}),
          videoPlaybackUrl: embedUrl,
          audioPlaybackUrl: undefined,
          playbackStrategy: 'embed',
        },
      };
      state.current.item = fallbackItem;
      loadMedia(fallbackItem);
      return;
    }
    mediaEl.textContent = 'Media: audio stream failed';
  } else {
    mediaEl.textContent = 'Media: error';
  }
  console.error(media.error);
}

[video, audio].filter(Boolean).forEach((element) => {
  element.addEventListener('play', onMediaPlay);
  element.addEventListener('playing', onMediaPlaying);
  element.addEventListener('canplay', onMediaCanPlay);
  element.addEventListener('waiting', onMediaWaiting);
  element.addEventListener('stalled', onMediaWaiting);
  element.addEventListener('loadeddata', onMediaLoadedData);
  element.addEventListener('pause', onMediaPause);
  element.addEventListener('seeked', onMediaSeeked);
  element.addEventListener('ended', onMediaEnded);
  element.addEventListener('error', onMediaError);
});

window.addEventListener('message', (event) => {
  if (!embeddedMode || !youtube || event.source !== youtube.contentWindow) return;
  let payload = event.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }
  if (!payload || typeof payload !== 'object') return;

  if (payload.event === 'infoDelivery' && payload.info && typeof payload.info.currentTime === 'number') {
    embeddedCurrentTime = payload.info.currentTime;
  }

  if (payload.event !== 'onStateChange') return;
  const info = Number(payload.info);
  if (info === 1) {
    mediaEl.textContent = 'Media: embedded video playing';
    syncEmbeddedNativePlayback('play');
  } else if (info === 2) {
    mediaEl.textContent = 'Media: embedded video paused';
    syncEmbeddedNativePlayback('pause');
  } else if (info === 0) {
    mediaEl.textContent = 'Media: embedded video ended';
    control('next', 0).catch((err) => {
      errorEl.textContent = err && err.message ? err.message : String(err);
    });
  } else if (info === 3) {
    mediaEl.textContent = 'Media: embedded video buffering';
  }
});

if (youtube) {
  youtube.addEventListener('load', () => {
    if (!embeddedMode) return;
    registerYouTubeListeners();
    applyVolume();
    if (state && state.playback && state.playback.status === 'playing') startVideoPlayback();
  });
}

try {
  applyVolume();
  discordHandshake();
  refresh();
  setInterval(refresh, 1000);
} catch (err) {
  statusEl.textContent = 'Activity error';
  errorEl.textContent = err && err.message ? err.message : String(err);
  console.error(err);
}
`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const rawSessionId = requestUrl.searchParams.get('sessionId') || requestUrl.searchParams.get('session_id');
  const sessionId = getDefaultActivitySessionId(rawSessionId);
  const appBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;
  return new NextResponse(js(DISCORD_CLIENT_ID, sessionId, appBaseUrl), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
