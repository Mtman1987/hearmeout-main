import { createLocalMediaGain } from './local-media-gain';
import { LISTENER_AUDIO_PREFIX } from './listener-audio';
import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID } from './watch-session';

// This is the only media-player implementation. Activity, room, overlay and
// popout pages all serve/embed it. Browsers receive the same worker stream;
// they never extract provider media, start their own queue or write playback.
export function sharedPlayerScript(clientId: string, initialSessionId: string, appBaseUrl: string) {
  return `
const CLIENT_ID = ${JSON.stringify(clientId)};
const APP_BASE_URL = ${JSON.stringify(appBaseUrl)};
const MOVIE_SESSION_ID = ${JSON.stringify(GLOBAL_WATCH_SESSION_ID)};
const MUSIC_SESSION_ID = ${JSON.stringify(MUSIC_WATCH_SESSION_ID)};
const AUDIO_KEY_PREFIX = ${JSON.stringify(LISTENER_AUDIO_PREFIX)};
const params = new URLSearchParams(location.search);
const IS_DISCORD_ACTIVITY = Boolean(params.get('frame_id')) || location.hostname.endsWith('.discordsays.com');
function normalizeSessionAlias(value, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === MUSIC_SESSION_ID || /-(music|song|songs|radio|dj)$/.test(raw) || ['music','song','songs','radio','dj'].includes(raw)) return MUSIC_SESSION_ID;
  if (raw === MOVIE_SESSION_ID || /-(movie|movies|video)$/.test(raw) || ['watch','movie','movies','video','videos','main','default','global'].includes(raw)) return MOVIE_SESSION_ID;
  return fallback === MUSIC_SESSION_ID ? MUSIC_SESSION_ID : MOVIE_SESSION_ID;
}
let sessionId = normalizeSessionAlias(params.get('sessionId'), ${JSON.stringify(initialSessionId)});
function pairedSessionIds() { return { movie: MOVIE_SESSION_ID, music: MUSIC_SESSION_ID }; }
function appUrl(value) {
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin && url.origin !== new URL(APP_BASE_URL).origin) return url.href;
  const path = url.pathname.replace(/^\\/\\.proxy(?=\\/)/, '') + url.search;
  return IS_DISCORD_ACTIVITY ? '/.proxy' + path : path;
}
function apiUrls(path) { return [appUrl(path)]; }
async function api(path, options) {
  const response = await fetch(appUrl(path), { ...options, cache: 'no-store', headers: { 'content-type': 'application/json', ...(options && options.headers || {}) } });
  const contentType = response.headers.get('content-type') || '';
  let payload;
  try {
    if (!contentType.includes('application/json')) throw new Error('Non-JSON response');
    payload = await response.json();
  } catch (_) {
    throw new Error(IS_DISCORD_ACTIVITY ? 'HearMeOut could not connect through Discord. Please reopen the Activity.' : 'HearMeOut returned an invalid response. Please try again.');
  }
  if (!response.ok || payload.success === false || payload.error) {
    const error = new Error(payload.result && payload.result.message || payload.error || 'Request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
const video = document.getElementById('video');
const localGain = (${createLocalMediaGain.toString()})(video);
const volumeInput = document.getElementById('volume');
const volumeLabel = document.getElementById('volume-label');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('activity-status');
const errorEl = document.getElementById('error');
const queueEl = document.getElementById('queue');
const queryInput = document.getElementById('query');
const requestForm = document.getElementById('request-form');
const requestButton = document.getElementById('request-button');
const recommendationButton = document.getElementById('accept-recommendation');
const laneButtons = Array.from(document.querySelectorAll('[data-session-switch]'));
let state = null;
let hls = null;
let currentRequestId = null;
let generation = 0;
let localVolume = 0.85;
let pollInFlight = false;
let disposed = false;
let retryAt = 0;
let mediaFailures = 0;
let lastProgressAt = Date.now();
let lastMediaTime = -1;
let recommendation = null;
let autoplayBlocked = false;
function audioKey() { return AUDIO_KEY_PREFIX + (sessionId === MUSIC_SESSION_ID ? 'music' : 'movie'); }
function readVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(audioKey()) || '{}');
    localVolume = typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.85;
  } catch (_) { localVolume = 0.85; }
}
function applyVolume() {
  // Gain zero is silent playback. Do not set muted, pause, unsubscribe or send
  // a shared control. Polling always reads this current local value.
  localGain.setVolume(localVolume);
  volumeInput.value = String(Math.round(localVolume * 100));
  volumeLabel.textContent = Math.round(localVolume * 100) + '%';
}
function persistVolume() {
  try { localStorage.setItem(audioKey(), JSON.stringify({ volume: localVolume })); } catch (_) {}
  window.dispatchEvent(new Event('hearmeout:listener-audio'));
}
function refreshVolume() { readVolume(); applyVolume(); }
volumeInput.addEventListener('input', () => {
  localVolume = Math.max(0, Math.min(100, Number(volumeInput.value))) / 100;
  persistVolume();
  applyVolume();
  // This gesture may satisfy the browser's audio permission. Playback itself
  // remains owned by the shared source, even at zero volume.
  void localGain.resume();
  if (currentRequestId) tryPlay();
});
window.addEventListener('storage', (event) => { if (event.key === null || event.key === audioKey()) refreshVolume(); });
window.addEventListener('hearmeout:listener-audio', refreshVolume);
async function tryPlay() {
  if (!currentRequestId || disposed) return;
  try {
    void localGain.resume();
    await video.play(); autoplayBlocked = localGain.blocked;
    statusEl.textContent = autoplayBlocked ? 'Adjust your volume to enable audio in this browser.' : 'Playing';
  }
  catch (error) {
    if (error && error.name === 'NotAllowedError') { autoplayBlocked = true; statusEl.textContent = 'Adjust your volume to enable audio in this browser.'; }
    else if (error && error.name !== 'AbortError') statusEl.textContent = 'Waiting for the shared stream';
  }
}
function destroyMedia() {
  generation++;
  if (hls) { hls.destroy(); hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
}
function loadMedia(request) {
  destroyMedia();
  currentRequestId = request.requestId;
  const ownGeneration = generation;
  const source = appUrl(request.item.playbackUrl);
  applyVolume();
  autoplayBlocked = false;
  statusEl.textContent = 'Opening stream';
  lastProgressAt = Date.now();
  lastMediaTime = -1;
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      startPosition: -1,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (generation === ownGeneration) tryPlay(); });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (generation !== ownGeneration || !data.fatal) return;
      statusEl.textContent = 'Reconnecting to the shared stream';
      // Retry the same source with a bounded delay. Never fall back to a
      // per-viewer YouTube iframe, extractor or direct provider connection.
      retryAt = Date.now() + Math.min(30000, 2000 * Math.pow(2, mediaFailures++));
    });
    hls.loadSource(source);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = source;
    tryPlay();
  } else { statusEl.textContent = 'This browser cannot play the shared stream.'; }
}
video.addEventListener('loadeddata', tryPlay);
video.addEventListener('playing', () => { statusEl.textContent = 'Playing'; retryAt = 0; mediaFailures = 0; });
video.addEventListener('waiting', () => { statusEl.textContent = 'Buffering'; });
video.addEventListener('error', () => { if (currentRequestId) retryAt = Date.now() + 5000; });
// No native play/pause/seek/ended/volume event ever changes the shared queue.
// Only the worker reports completion and advances the single source.
function renderState(nextState) {
  state = nextState;
  titleEl.textContent = state.current ? state.current.item.title : 'Waiting for a request';
  queueEl.replaceChildren();
  for (const request of state.queue || []) {
    const li = document.createElement('li');
    li.textContent = request.item.title + (request.requestedBy.username ? ' · ' + request.requestedBy.username : '');
    queueEl.appendChild(li);
  }
  if (!(state.queue || []).length) { const li = document.createElement('li'); li.textContent = 'Queue is empty.'; queueEl.appendChild(li); }
  const nextId = state.current && state.current.requestId;
  if (nextId !== currentRequestId) {
    retryAt = 0;
    mediaFailures = 0;
    if (state.current) loadMedia(state.current);
    else { destroyMedia(); currentRequestId = null; statusEl.textContent = 'Waiting for a request'; }
  } else if (retryAt && Date.now() >= retryAt && state.current) {
    retryAt = 0;
    loadMedia(state.current);
  }
}
async function refresh() {
  if (pollInFlight || disposed) return;
  pollInFlight = true;
  const requestedSessionId = sessionId;
  try {
    const nextState = await api('/api/watch/sessions/' + requestedSessionId + '/state');
    if (!disposed && sessionId === requestedSessionId) renderState(nextState);
  } catch (error) { if (sessionId === requestedSessionId) statusEl.textContent = error.message; }
  finally { pollInFlight = false; }
}
function setActiveSessionTab() {
  for (const button of laneButtons) button.setAttribute('aria-pressed', String(button.dataset.sessionSwitch === (sessionId === MUSIC_SESSION_ID ? 'music' : 'movie')));
}
async function switchSession(value) {
  const next = normalizeSessionAlias(value, sessionId);
  if (next === sessionId) return;
  sessionId = next;
  destroyMedia(); currentRequestId = null; state = null; retryAt = 0;
  recommendation = null; recommendationButton.hidden = true;
  titleEl.textContent = 'Waiting for a request'; errorEl.textContent = '';
  refreshVolume(); setActiveSessionTab();
  const url = new URL(location.href); url.searchParams.set('sessionId', sessionId); history.replaceState(null, '', url);
  await refresh();
}
for (const button of laneButtons) button.addEventListener('click', () => switchSession(button.dataset.sessionSwitch));
function requesterId() {
  try {
    let id = localStorage.getItem('hmo_user_id');
    if (!id) { id = 'listener-' + crypto.randomUUID(); localStorage.setItem('hmo_user_id', id); }
    return id;
  } catch (_) { return 'listener'; }
}
requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query || requestButton.disabled) return;
  const requestedSessionId = sessionId;
  requestButton.disabled = true; errorEl.textContent = ''; recommendationButton.hidden = true;
  try {
    const payload = await api('/api/watch/sessions/' + requestedSessionId + '/request', {
      method: 'POST', body: JSON.stringify({ query, mediaType: requestedSessionId === MUSIC_SESSION_ID ? 'music' : 'movie', userId: requesterId(), username: 'Listener', platform: IS_DISCORD_ACTIVITY ? 'activity' : 'web' }),
    });
    if (requestedSessionId === sessionId) { renderState(payload.session); queryInput.value = ''; }
  } catch (error) {
    if (requestedSessionId === sessionId) {
      errorEl.textContent = error.message;
      recommendation = error.payload && error.payload.recommendation;
      recommendationButton.hidden = !recommendation;
      if (recommendation) recommendationButton.textContent = 'Request ' + recommendation.title;
    }
  } finally { requestButton.disabled = false; }
});
recommendationButton.addEventListener('click', async () => {
  if (!recommendation) return;
  const requestedSessionId = sessionId;
  recommendationButton.disabled = true;
  try {
    const payload = await api('/api/watch/sessions/' + requestedSessionId + '/accept', { method: 'POST', body: JSON.stringify({ userId: requesterId(), username: 'Listener' }) });
    if (requestedSessionId === sessionId) { renderState(payload.session); recommendationButton.hidden = true; }
  } catch (error) { errorEl.textContent = error.message; }
  finally { recommendationButton.disabled = false; }
});
function discordHandshake() {
  const frameId = params.get('frame_id');
  if (!frameId || !CLIENT_ID) return;
  let origin = '*';
  try { if (document.referrer) origin = new URL(document.referrer).origin; } catch (_) {}
  window.parent.postMessage([0, { v: 1, encoding: 'json', client_id: CLIENT_ID, frame_id: frameId, sdk_version: '2.5.0' }], origin);
}
refreshVolume(); setActiveSessionTab(); discordHandshake(); refresh();
const pollTimer = setInterval(refresh, 2000);
const progressTimer = setInterval(() => {
  if (!currentRequestId || autoplayBlocked) return;
  if (video.currentTime !== lastMediaTime) { lastMediaTime = video.currentTime; lastProgressAt = Date.now(); }
  else if (Date.now() - lastProgressAt > 30000 && !retryAt) retryAt = Date.now() + 2000;
}, 2000);
window.addEventListener('pagehide', () => { disposed = true; clearInterval(pollTimer); clearInterval(progressTimer); destroyMedia(); localGain.close(); });
`;
}
