import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { getDefaultActivitySessionId, getResolvedWatchSession } from '@/lib/watch/watch-request-service';
import { getGlobalMusicWatchSession } from '@/lib/music-session-service';
import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

export function js(clientId: string, sessionId: string) {
  const appBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hearmeout-main.fly.dev';
  return `
const CLIENT_ID = ${JSON.stringify(clientId)};
const GLOBAL_SESSION_ID = ${JSON.stringify(sessionId)};
const APP_BASE_URL = ${JSON.stringify(appBaseUrl.replace(/\/$/, ''))};
const MOVIE_SESSION_ID = 'discord-watch-room';
const MUSIC_SESSION_ID = 'discord-music-room';
const params = new URLSearchParams(location.search);
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
const muteBtn = document.getElementById('mute');
const volumeInput = document.getElementById('volume');
const volumeLabel = document.getElementById('volume-label');
const requestForm = document.getElementById('request-form');
const queryInput = document.getElementById('query');
const acceptRecommendationBtn = document.getElementById('accept-recommendation');
const sessionSwitchButtons = Array.from(document.querySelectorAll('[data-session-switch]'));
let state = null;
let currentRequestId = null;
let hls = null;
let applying = false;
let lastSeekApplyAt = 0;
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
const MEDIA_ERROR_FALLBACK_THRESHOLD = 1;

function setActiveSessionTab() {
  sessionSwitchButtons.forEach((button) => {
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

function isYoutubeAudioMusicItem(item) {
  return item?.type === 'music' && String(playbackUrlForItem(item) || '').toLowerCase().includes('/api/youtube-audio/');
}

function youtubeEmbedUrlForItem(item) {
  const videoId = item?.metadata?.videoId || String(item?.id || '').replace(/^youtube-/, '');
  return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) : '';
}

function playbackUrlForItem(item) {
  if (hasMusicModeToggle(item)) {
    const options = musicModeOptions(item);
    return musicPlaybackMode === 'audio' ? options.audio : options.video;
  }
  return item?.playbackUrl || '';
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
  if (nextPath.startsWith('/api/watch/xtream/hls/')) nextPath = nextPath.replace('/api/watch/xtream/hls/', '/activity-provider/xtream/hls/');
  if (nextPath.startsWith('/activity/watch/xtream/hls/')) nextPath = nextPath.replace('/activity/watch/xtream/hls/', '/api/watch/xtream/hls/');
  if (nextPath.startsWith('/activity/proxy')) nextPath = nextPath.replace('/activity/proxy', '/activity-proxy');
  return nextPath;
}

function iframeUrlFor(path) {
  const resolved = appUrl(path);
  if (!resolved || !isEmbeddedVideoItem({ playbackUrl: resolved, metadata: { provider: 'youtube' } })) return resolved;
  try {
    const url = new URL(resolved, window.location.href);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
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
  if (embeddedMode) {
    youtubeCommand('setVolume', [value]);
    youtubeCommand(muted || value === 0 ? 'mute' : 'unMute');
    muteBtn.textContent = muted || value === 0 ? '🔇' : '🔊';
    muteBtn.title = muted || value === 0 ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', muteBtn.title);
    volumeLabel.textContent = (muted ? 0 : value) + '%';
    return;
  }
  media.volume = value / 100;
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
  const response = await fetch(appUrl(path), {
    ...requestOptions,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error((payload && payload.error) || 'Request failed: ' + response.status);
    error.payload = payload;
    throw error;
  }
  return response.json();
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
    return;
  }
  if (mediaIsBuffering || media.readyState < 2) return;
  const remote = position(state.playback);
  const drift = Math.abs((media.currentTime || 0) - remote);
  applying = true;
  const now = Date.now();
  const isLive = state.current.item.type === 'live' || state.current.item.runtime === 'live';
  if (!isLive && Number.isFinite(media.duration) && media.duration > 0 && remote >= media.duration - 0.5) {
    setTimeout(() => { applying = false; }, 100);
    return;
  }
  if (!isLive && drift > 8 && Number.isFinite(remote) && now - lastSeekApplyAt > 5000) {
    lastSeekApplyAt = now;
    media.currentTime = remote;
  }
  const playSyncInFlight = syncingNativeControl && Date.now() - lastNativePlayAt < 5000;
  if (state.playback.status === 'paused' && !media.paused && !playSyncInFlight) media.pause();
  if (state.playback.status === 'playing' && media.paused && !pendingPlay) startVideoPlayback();
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
      mediaEl.textContent = 'Media: press the video play control';
      console.warn(err);
      return false;
    });
}

function syncNativePlayback(action) {
  return;
}

function loadMedia(item) {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  setActiveMediaForItem(item);
  resetInactiveMedia();
  video.removeAttribute('src');
  if (audio) audio.removeAttribute('src');
  lastSeekApplyAt = 0;
  lastEmbeddedPlaybackKey = '';
  embeddedCurrentTime = 0;
  lastEmbeddedNativeSyncAt = 0;
  activeMediaErrorKey = state?.current ? state.current.requestId + ':' + playbackUrlForItem(item) : '';
  if (activeMediaErrorKey) mediaErrorCounts[activeMediaErrorKey] = mediaErrorCounts[activeMediaErrorKey] || 0;
  mediaIsBuffering = true;
  pendingPlay = false;
  mediaEl.textContent = 'Media: loading ' + item.title;
  const playbackUrl = appUrl(playbackUrlForItem(item));
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
  } else if (isHlsPlaybackUrl(item.playbackUrl) && window.Hls && window.Hls.isSupported()) {
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
      mediaEl.textContent = 'Media: ready';
      mediaIsBuffering = false;
      if (state && state.playback && state.playback.status === 'playing') startVideoPlayback();
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      const details = data && (data.details || data.type || data.reason || data.response && data.response.code);
      mediaEl.textContent = data && data.fatal
        ? 'Media: HLS error' + (details ? ' - ' + details : '')
        : 'Media: buffering' + (details ? ' - ' + details : '');
      if (data && data.fatal) console.warn('HLS fatal error', data);
    });
    hls.loadSource(playbackUrl);
    hls.attachMedia(video);
  } else {
    video.src = playbackUrl;
    video.load();
  }
  applyVolume();
}

function render(nextState) {
  state = nextState;
  if (state.playback && typeof state.playback.muted === 'boolean' && muted !== state.playback.muted) {
    muted = state.playback.muted;
    applyVolume();
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
      musicPlaybackMode = state.current.item?.metadata?.playbackMode || 'video';
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
    const controlUrl = '/api/watch/sessions/' + sessionId + '/quick-control?action=' + encodeURIComponent(action) + '&position=' + encodeURIComponent(String(body.position || 0)) + '&format=json';
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
  if (action === 'local-play') {
    mediaEl.textContent = 'Media: starting';
    pendingPlay = true;
    startVideoPlayback().catch((err) => console.warn('Local playback failed', err));
    return;
  }
  if (action === 'sync-local') {
    applyPlayback();
    mediaEl.textContent = 'Media: synced to live position';
    return;
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
  const item = state.current.item;
  const popup = window.open('', 'watch-popout-' + sessionId, 'popup=yes,width=1100,height=680');
  if (!popup) {
    errorEl.textContent = 'Discord blocked the popout window.';
    return;
  }
  const title = String(item.title || 'Watch video').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char));
  const selectedPlaybackUrl = playbackUrlForItem(item);
  const selectedItem = { ...item, playbackUrl: selectedPlaybackUrl, metadata: { ...(item.metadata || {}), videoPlaybackUrl: selectedPlaybackUrl, audioPlaybackUrl: '' } };
  const src = JSON.stringify(selectedPlaybackUrl);
  if (isEmbeddedVideoItem(selectedItem)) {
    popup.document.write('<!doctype html><html><head><title>' + title + '</title><style>html,body{height:100%;margin:0;background:#000;color:#e5edf5;font-family:Arial,sans-serif}body{display:grid;grid-template-rows:auto 1fr}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;background:#111827}iframe{width:100%;height:100%;border:0;background:#000}</style></head><body><header><strong>' + title + '</strong></header><iframe src=' + src + ' allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>');
  } else {
    popup.document.write('<!doctype html><html><head><title>' + title + '</title><style>html,body{height:100%;margin:0;background:#000;color:#e5edf5;font-family:Arial,sans-serif}body{display:grid;grid-template-rows:auto 1fr}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;background:#111827}button{border:1px solid #475569;background:#1e293b;color:#e5edf5;border-radius:6px;padding:7px 10px}video{width:100%;height:100%;background:#000;display:block}</style></head><body><header><strong>' + title + '</strong><button onclick="document.querySelector(\\'video\\').requestFullscreen()">Fullscreen</button></header><video id="video" controls autoplay playsinline></video><script>const src=' + src + ';const video=document.getElementById("video");const hlsConfig={enableWorker:false,lowLatencyMode:false,backBufferLength:30,manifestLoadingTimeOut:60000,manifestLoadingMaxRetry:4,manifestLoadingRetryDelay:1000,manifestLoadingMaxRetryTimeout:8000,fragLoadingTimeOut:60000,fragLoadingMaxRetry:4,fragLoadingRetryDelay:1000,fragLoadingMaxRetryTimeout:8000};if(src.endsWith(".m3u8")){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/hls.js@latest";s.onload=()=>{if(window.Hls&&window.Hls.isSupported()){const hls=new window.Hls(hlsConfig);hls.loadSource(src);hls.attachMedia(video)}else{video.src=src}};document.head.appendChild(s)}else{video.src=src}<\\/script></body></html>');
  }
  popup.document.close();
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

volumeInput.addEventListener('input', () => {
  if (Number(volumeInput.value || 0) > 0) muted = false;
  applyVolume();
  mediaEl.textContent = 'Media: volume ' + volumeLabel.textContent;
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  setPendingRecommendation(null);
  const query = queryInput.value.trim();
  if (!query) return;
  try {
    const isMusicSession = sessionId === MUSIC_SESSION_ID || String(sessionId || '').toLowerCase().includes('music');
    const requestUrl = '/api/watch/sessions/' + sessionId + '/request?query=' + encodeURIComponent(query) + '&username=' + encodeURIComponent('activity tester') + '&userId=activity' + (isMusicSession ? '&mediaType=music' : '');
    const result = await api(requestUrl);
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
      body: JSON.stringify({ username: 'activity tester' }),
    });
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
function onMediaPlaying(event) { if (event.currentTarget === media) mediaEl.textContent = 'Media: playing'; }
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
  mediaEl.textContent = 'Media: ended';
}
function onMediaError(event) {
  if (event.currentTarget !== media) return;
  const item = state?.current?.item;
  const errorKey = activeMediaErrorKey || (state?.current ? state.current.requestId + ':' + playbackUrlForItem(item) : '');
  const attempts = (mediaErrorCounts[errorKey] || 0) + 1;
  mediaErrorCounts[errorKey] = attempts;
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
  const musicSession = await getGlobalMusicWatchSession();
  const movieSession = getResolvedWatchSession(GLOBAL_WATCH_SESSION_ID);
  const sessionId = rawSessionId
    ? getDefaultActivitySessionId(rawSessionId)
    : !movieSession.current && musicSession.current
      ? MUSIC_WATCH_SESSION_ID
      : GLOBAL_WATCH_SESSION_ID;
  return new NextResponse(js(DISCORD_CLIENT_ID, sessionId), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
