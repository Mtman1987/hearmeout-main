import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { GLOBAL_WATCH_SESSION_ID } from '@/lib/watch-session';

export function js(clientId: string, sessionId: string) {
  const appBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hearmeout-main.fly.dev';
  return `
const CLIENT_ID = ${JSON.stringify(clientId)};
const GLOBAL_SESSION_ID = ${JSON.stringify(sessionId)};
const APP_BASE_URL = ${JSON.stringify(appBaseUrl.replace(/\/$/, ''))};
const params = new URLSearchParams(location.search);
function cleanScopePart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
let sessionId = cleanScopePart(params.get('sessionId') || params.get('session_id') || '')
  || GLOBAL_SESSION_ID;
const video = document.getElementById('video');
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
const muteBtn = document.getElementById('mute');
const volumeInput = document.getElementById('volume');
const volumeLabel = document.getElementById('volume-label');
const requestForm = document.getElementById('request-form');
const queryInput = document.getElementById('query');
const acceptRecommendationBtn = document.getElementById('accept-recommendation');
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

function downloadUrlFor(url) {
  if (!url || !url.startsWith('/')) return url;
  const next = new URL(appUrl(url), window.location.href);
  next.searchParams.set('download', '1');
  return next.toString();
}

function downloadUrlForItem(item) {
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
  video.volume = value / 100;
  video.muted = muted || value === 0;
  muteBtn.textContent = video.muted ? '🔇' : '🔊';
  muteBtn.title = video.muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', muteBtn.title);
  volumeLabel.textContent = (video.muted ? 0 : value) + '%';
}

document.getElementById('room').textContent = 'Room ' + sessionId;
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
  if (mediaIsBuffering || video.readyState < 2) return;
  const remote = position(state.playback);
  const drift = Math.abs((video.currentTime || 0) - remote);
  applying = true;
  const now = Date.now();
  const isLive = state.current.item.type === 'live' || state.current.item.runtime === 'live';
  if (!isLive && Number.isFinite(video.duration) && video.duration > 0 && remote >= video.duration - 0.5) {
    if (!syncingCompletedPlayback) {
      syncingCompletedPlayback = true;
      control('next').finally(() => { syncingCompletedPlayback = false; });
    }
    setTimeout(() => { applying = false; }, 100);
    return;
  }
  if (!isLive && drift > 8 && Number.isFinite(remote) && now - lastSeekApplyAt > 5000) {
    lastSeekApplyAt = now;
    video.currentTime = remote;
  }
  const playSyncInFlight = syncingNativeControl && Date.now() - lastNativePlayAt < 5000;
  if (state.playback.status === 'paused' && !video.paused && !playSyncInFlight) video.pause();
  if (state.playback.status === 'playing' && video.paused && !pendingPlay) startVideoPlayback();
  setTimeout(() => { applying = false; }, 100);
}

function startVideoPlayback() {
  if (!state || !state.current) return Promise.resolve(false);
  pendingPlay = true;
  if (video.readyState < 2) {
    mediaEl.textContent = 'Media: loading';
    return Promise.resolve(false);
  }
  return video.play()
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
  if (!state || !state.current || applying || syncingCompletedPlayback || syncingNativeControl) return;
  if (pendingPlay && action === 'play') return;
  if (action === 'play') {
    lastNativePlayAt = Date.now();
    state.playback = {
      ...state.playback,
      status: 'playing',
      position: video.currentTime || state.playback.position || 0,
      updatedAt: Date.now(),
    };
  }
  syncingNativeControl = true;
  control(action)
    .catch((err) => console.warn('Native playback sync failed', err))
    .finally(() => { syncingNativeControl = false; });
}

function loadMedia(item) {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.removeAttribute('src');
  lastSeekApplyAt = 0;
  mediaIsBuffering = true;
  pendingPlay = false;
  mediaEl.textContent = 'Media: loading ' + item.title;
  const playbackUrl = appUrl(item.playbackUrl);
  if (isHlsPlaybackUrl(item.playbackUrl) && window.Hls && window.Hls.isSupported()) {
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
  }
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
  empty.classList.toggle('hidden', Boolean(state.current));
  empty.style.display = state.current ? 'none' : 'grid';
  document.querySelectorAll('[data-action="next"]').forEach((button) => { button.disabled = !state.queue.length; });
  popoutBtn.disabled = !state.current;
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
      loadMedia(state.current.item);
    }
    applyPlayback();
  } else {
    titleEl.textContent = 'Waiting for a request';
    mediaEl.textContent = 'Media: idle';
    currentDownloadUrl = '';
    downloadLink.disabled = true;
  }
  const queueRows = [];
  if (state.current) {
    queueRows.push('<li><strong>Now playing:</strong> ' + escapeHtml(state.current.item.title) + '</li>');
  }
  if (state.queue.length) {
    queueRows.push(...state.queue.map((request, index) => '<li><button type="button" class="queue-item" data-queue-index="' + index + '" title="Play ' + escapeHtml(request.item.title) + '"><span class="queue-index">' + (index + 1) + '</span><strong>' + escapeHtml(request.item.title) + '</strong></button></li>'));
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
  const body = { action, position: Number.isFinite(positionOverride) ? positionOverride : (video.currentTime || 0) };
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

async function jumpToQueueIndex(index) {
  if (!Number.isInteger(index) || index < 0) return;
  mediaEl.textContent = 'Media: loading selected';
  try {
    const controlUrl = '/api/watch/sessions/' + sessionId + '/quick-control?action=jump&targetIndex=' + encodeURIComponent(String(index)) + '&position=0&format=json';
    const result = await api(controlUrl);
    render(result.session);
    if (!state || !state.current) {
      mediaEl.textContent = 'Media: queue ended';
      return;
    }
    pendingPlay = true;
    await control('play', 0);
    await startVideoPlayback();
  } catch (err) {
    errorEl.textContent = err && err.message ? err.message : String(err);
    console.warn('Queue jump failed', err);
  }
}

function handleAction(action) {
  if (action === 'play') {
    mediaEl.textContent = 'Media: starting';
    pendingPlay = true;
    control('play')
      .then(() => startVideoPlayback())
      .catch((err) => console.warn('Control failed', err));
    return;
  }
  if (action === 'next') {
    mediaEl.textContent = 'Media: loading next';
    control('next')
      .then(() => {
        if (!state || !state.current) return false;
        pendingPlay = true;
        return control('play', 0).then(() => startVideoPlayback());
      })
      .catch((err) => console.warn('Control failed', err));
    return;
  }
  control(action).catch((err) => console.warn('Control failed', err));
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

queueEl.addEventListener('click', (event) => {
  const button = event.target && event.target.closest ? event.target.closest('[data-queue-index]') : null;
  if (!button) return;
  event.preventDefault();
  jumpToQueueIndex(Number(button.dataset.queueIndex));
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
  const src = JSON.stringify(item.playbackUrl);
  popup.document.write('<!doctype html><html><head><title>' + title + '</title><style>html,body{height:100%;margin:0;background:#000;color:#e5edf5;font-family:Arial,sans-serif}body{display:grid;grid-template-rows:auto 1fr}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;background:#111827}button{border:1px solid #475569;background:#1e293b;color:#e5edf5;border-radius:6px;padding:7px 10px}video{width:100%;height:100%;background:#000;display:block}</style></head><body><header><strong>' + title + '</strong><button onclick="document.querySelector(\\'video\\').requestFullscreen()">Fullscreen</button></header><video id="video" controls autoplay playsinline></video><script>const src=' + src + ';const video=document.getElementById("video");const hlsConfig={enableWorker:false,lowLatencyMode:false,backBufferLength:30,manifestLoadingTimeOut:60000,manifestLoadingMaxRetry:4,manifestLoadingRetryDelay:1000,manifestLoadingMaxRetryTimeout:8000,fragLoadingTimeOut:60000,fragLoadingMaxRetry:4,fragLoadingRetryDelay:1000,fragLoadingMaxRetryTimeout:8000};if(src.endsWith(".m3u8")){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/hls.js@latest";s.onload=()=>{if(window.Hls&&window.Hls.isSupported()){const hls=new window.Hls(hlsConfig);hls.loadSource(src);hls.attachMedia(video)}else{video.src=src}};document.head.appendChild(s)}else{video.src=src}<\\/script></body></html>');
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
  control(video.muted ? 'unmute' : 'mute')
    .catch((err) => console.warn('Mute control failed', err));
});

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
    const requestUrl = '/api/watch/sessions/' + sessionId + '/request?query=' + encodeURIComponent(query) + '&username=' + encodeURIComponent('activity tester') + '&userId=activity';
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

video.addEventListener('play', () => {
  if (state && state.playback && state.playback.status !== 'playing') syncNativePlayback('play');
});
video.addEventListener('playing', () => { mediaEl.textContent = 'Media: playing'; });
video.addEventListener('canplay', () => { mediaIsBuffering = false; mediaEl.textContent = 'Media: ready'; if (pendingPlay || (state && state.playback && state.playback.status === 'playing')) startVideoPlayback(); });
video.addEventListener('waiting', () => { mediaIsBuffering = true; mediaEl.textContent = 'Media: buffering'; });
video.addEventListener('stalled', () => { mediaIsBuffering = true; mediaEl.textContent = 'Media: buffering'; });
video.addEventListener('loadeddata', () => { mediaIsBuffering = false; if (pendingPlay || (state && state.playback && state.playback.status === 'playing')) startVideoPlayback(); });
video.addEventListener('pause', () => {
  if (!video.ended) {
    mediaEl.textContent = 'Media: paused';
  }
});
video.addEventListener('seeked', () => { if (!applying && state && state.current) control('seek'); });
video.addEventListener('ended', () => {
  mediaEl.textContent = 'Media: ended';
  if (!state || syncingCompletedPlayback) return;
  syncingCompletedPlayback = true;
  control('next').finally(() => { syncingCompletedPlayback = false; });
});
video.addEventListener('error', () => {
  mediaEl.textContent = 'Media: error';
  console.error(video.error);
});

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

export async function GET() {
  return new NextResponse(js(DISCORD_CLIENT_ID, GLOBAL_WATCH_SESSION_ID), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
