import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';

function js(clientId: string) {
  return `
const CLIENT_ID = ${JSON.stringify(clientId)};
const params = new URLSearchParams(location.search);
const clean = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
let sessionId = clean((params.get('guild_id') || 'local') + '-' + (params.get('channel_id') || 'watch'));
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
let state = null;
let currentRequestId = null;
let hls = null;
let applying = false;
let lastSeekApplyAt = 0;
let mediaIsBuffering = false;
let muted = false;
let currentDownloadUrl = '';

function downloadUrlFor(url) {
  if (!url || !url.startsWith('/')) return url;
  const next = new URL(url, window.location.origin);
  next.searchParams.set('download', '1');
  return next.toString();
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
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...((options && options.headers) || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error((payload && payload.error) || 'Request failed: ' + response.status);
  }
  return response.json();
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
  if (!isLive && drift > 8 && Number.isFinite(remote) && now - lastSeekApplyAt > 5000) {
    lastSeekApplyAt = now;
    video.currentTime = remote;
  }
  if (state.playback.status === 'paused' && !video.paused) video.pause();
  setTimeout(() => { applying = false; }, 100);
}

function loadMedia(item) {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.removeAttribute('src');
  lastSeekApplyAt = 0;
  mediaIsBuffering = true;
  mediaEl.textContent = 'Media: loading ' + item.title;
  if (item.playbackUrl.endsWith('.m3u8') && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls();
    hls.loadSource(item.playbackUrl);
    hls.attachMedia(video);
  } else {
    video.src = item.playbackUrl;
  }
}

function render(nextState) {
  state = nextState;
  if (state.id && state.id !== sessionId) {
    sessionId = state.id;
    document.getElementById('room').textContent = 'Room ' + sessionId;
  }
  empty.style.display = state.current ? 'none' : 'grid';
  document.querySelectorAll('[data-action="next"]').forEach((button) => { button.disabled = !state.queue.length; });
  popoutBtn.disabled = !state.current;
  if (state.current) {
    titleEl.textContent = state.current.item.title + ' (' + state.current.item.year + ')';
    const url = state.current.item.playbackUrl || '';
    if (url) {
      currentDownloadUrl = downloadUrlFor(url);
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
  queueEl.innerHTML = state.queue.length
    ? state.queue.map((request, index) => '<li>' + (index + 1) + '. ' + request.item.title + '</li>').join('')
    : '<li>Queue is empty.</li>';
  eventsEl.innerHTML = state.events.length
    ? state.events.slice(0, 8).map((event) => '<li>' + new Date(event.at).toLocaleTimeString() + ' - ' + event.message + '</li>').join('')
    : '<li>No events yet.</li>';
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
    errorEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Disconnected';
    errorEl.textContent = err && err.message ? err.message : String(err);
    console.error(err);
  }
}

async function control(action) {
  const body = { action, position: video.currentTime || 0 };
  try {
    render(await api('/api/watch/sessions/' + sessionId + '/control', { method: 'POST', body: JSON.stringify(body) }));
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
  if (action === 'play') {
    mediaEl.textContent = 'Media: starting';
    video.play()
      .then(() => {
        mediaEl.textContent = 'Media: playing';
        return control('play');
      })
      .catch((err) => {
        mediaEl.textContent = 'Media: press the video play control';
        console.warn(err);
      });
    return;
  }
  control(action).catch((err) => console.warn('Control failed', err));
}

function handlePress(event) {
  const controlEl = event.target && event.target.closest ? event.target.closest('[data-action], [data-panel]') : null;
  if (!controlEl || controlEl.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  if (controlEl.dataset.panel) {
    setDrawer(controlEl.dataset.panel);
    return;
  }
  if (controlEl.dataset.action) {
    handleAction(controlEl.dataset.action);
  }
}

document.addEventListener('pointerup', handlePress);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  handlePress(event);
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
  popup.document.write('<!doctype html><html><head><title>' + title + '</title><style>html,body{height:100%;margin:0;background:#000;color:#e5edf5;font-family:Arial,sans-serif}body{display:grid;grid-template-rows:auto 1fr}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;background:#111827}button{border:1px solid #475569;background:#1e293b;color:#e5edf5;border-radius:6px;padding:7px 10px}video{width:100%;height:100%;background:#000;display:block}</style></head><body><header><strong>' + title + '</strong><button onclick="document.querySelector(\\'video\\').requestFullscreen()">Fullscreen</button></header><video id="video" controls autoplay playsinline></video><script>const src=' + src + ';const video=document.getElementById("video");if(src.endsWith(".m3u8")){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/hls.js@latest";s.onload=()=>{if(window.Hls&&window.Hls.isSupported()){const hls=new window.Hls();hls.loadSource(src);hls.attachMedia(video)}else{video.src=src}};document.head.appendChild(s)}else{video.src=src}<\\/script></body></html>');
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
  mediaEl.textContent = video.muted ? 'Media: muted' : 'Media: volume on';
});

volumeInput.addEventListener('input', () => {
  if (Number(volumeInput.value || 0) > 0) muted = false;
  applyVolume();
  mediaEl.textContent = 'Media: volume ' + volumeLabel.textContent;
});

document.getElementById('request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  const query = document.getElementById('query').value.trim();
  if (!query) return;
  try {
    const result = await api('/api/watch/sessions/' + sessionId + '/request', {
      method: 'POST',
      body: JSON.stringify({ query, username: 'activity tester' }),
    });
    document.getElementById('query').value = '';
    render(result.session);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

video.addEventListener('playing', () => { mediaEl.textContent = 'Media: playing'; });
video.addEventListener('canplay', () => { mediaIsBuffering = false; mediaEl.textContent = 'Media: ready'; });
video.addEventListener('waiting', () => { mediaIsBuffering = true; mediaEl.textContent = 'Media: buffering'; });
video.addEventListener('stalled', () => { mediaIsBuffering = true; mediaEl.textContent = 'Media: buffering'; });
video.addEventListener('loadeddata', () => { mediaIsBuffering = false; });
video.addEventListener('pause', () => { if (!video.ended) mediaEl.textContent = 'Media: paused'; });
video.addEventListener('seeked', () => { if (!applying && state && state.current) control('seek'); });
video.addEventListener('ended', () => { mediaEl.textContent = 'Media: ended'; });
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
  return new NextResponse(js(DISCORD_CLIENT_ID), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
