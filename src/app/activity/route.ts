import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { GLOBAL_WATCH_SESSION_ID, MUSIC_WATCH_SESSION_ID, normalizeWatchSessionAlias } from '@/lib/watch-session';
import { getPublicWatchSession, getResolvedWatchSession } from '@/lib/watch/watch-request-service';
import { js as activityJs } from '../activity-lite.js/route';

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function isHlsPlaybackUrl(value: string) {
  if (value.endsWith('.m3u8')) return true;
  try {
    const url = new URL(value, 'https://hearmeout.local');
    const proxied = url.searchParams.get('url');
    return Boolean(proxied?.endsWith('.m3u8'));
  } catch {
    return false;
  }
}

function html(request: Request) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = (configuredBaseUrl || new URL(request.url).origin).replace(/\/$/, '');
  const requestUrl = new URL(request.url);
  const requestedSessionId = normalizeWatchSessionAlias(
    requestUrl.searchParams.get('sessionId') || requestUrl.searchParams.get('session_id'),
    GLOBAL_WATCH_SESSION_ID,
  );
  const session = getPublicWatchSession(getResolvedWatchSession(requestedSessionId), baseUrl);
  const current = session.current;
  const title = current ? `${current.item.title} (${current.item.year})` : 'Waiting for a request';
  const media = current ? `${current.item.source} - requested by ${current.requestedBy.username}` : 'Media: idle';
  const src = current?.item.playbackUrl || '';
  const isEmbeddedVideo = src.includes('youtube.com/embed/') || src.includes('youtube-nocookie.com/embed/');
  const isAudioOnly = current?.item.type === 'tts' || current?.item.metadata?.provider === 'tts' || (current?.item.type === 'music' && src.includes('/api/youtube-audio/'));
  const nativeSrc = src && !isAudioOnly && !isEmbeddedVideo && !isHlsPlaybackUrl(src) ? src : '';
  const audioSrc = src && isAudioOnly ? src : '';
  const iframeSrc = src && isEmbeddedVideo ? src : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HearMeOut Discord Activity</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #000; color: #e5edf5; font-family: Arial, system-ui, sans-serif; }
    body { overflow: hidden; }
    main { width: 100vw; height: 100vh; background: #000; }
    .player { position: relative; width: 100%; height: 100%; background: #000; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; }
    header { display: none; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 18px; font-weight: 700; }
    h2 { font-size: 16px; margin-bottom: 10px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .status { color: #86efac; border: 1px solid rgba(52,211,153,.5); border-radius: 999px; padding: 5px 10px; font-size: 13px; white-space: nowrap; background: rgba(0,0,0,.45); }
    .video-wrap { position: relative; min-height: 0; background: #000; }
    video, iframe.youtube-player { width: 100%; height: 100%; background: #000; display: block; object-fit: contain; border: 0; }
    video.hidden, audio.hidden, iframe.hidden { display: none !important; }
    audio.audio-player { position: absolute; left: 50%; top: 50%; width: min(720px, calc(100vw - 32px)); transform: translate(-50%, -50%); z-index: 2; }
    .empty { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; color: #cbd5e1; background: rgba(0,0,0,.55); }
    .empty.hidden { display: none !important; }
    .room-tabs { position: fixed; top: 10px; left: 10px; z-index: 10; display: flex; gap: 6px; padding: 5px; border: 1px solid rgba(148,163,184,.35); border-radius: 8px; background: rgba(2,6,23,.78); backdrop-filter: blur(10px); }
    .room-tab { min-height: 34px; border-color: transparent; background: transparent; padding: 6px 10px; }
    .room-tab.active { border-color: rgba(52,211,153,.85); background: rgba(16,185,129,.18); color: #bbf7d0; }
    .toolbar { position: relative; z-index: 10; width: 100%; display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 7px; border-top: 1px solid rgba(148,163,184,.35); background: rgba(2,6,23,.96); }
    button, input { min-height: 38px; border-radius: 6px; border: 1px solid #475569; background: #172033; color: #e5edf5; padding: 8px 10px; font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:hover:not(:disabled), .download:hover { border-color: #34d399; }
    .icon-btn { min-width: 40px; width: 40px; padding: 0; display: inline-grid; place-items: center; }
    .panel-btn.active { border-color: #34d399; color: #bbf7d0; }
    .volume { min-width: 220px; flex: 1; display: flex; align-items: center; gap: 8px; border: 1px solid #475569; border-radius: 6px; background: #0f172a; padding: 7px 9px; }
    .volume input { min-height: 0; padding: 0; accent-color: #34d399; }
    .meta { position: fixed; left: 10px; right: 10px; bottom: 64px; z-index: 9; display: grid; justify-items: center; gap: 4px; text-align: center; pointer-events: none; text-shadow: 0 1px 4px #000; }
    aside { display: none; }
    aside.open { position: fixed; right: 10px; top: 58px; bottom: 76px; z-index: 12; display: block; width: min(360px, calc(100vw - 20px)); overflow: auto; padding: 0; color: #e5edf5; background: rgba(2,6,23,.92); border: 1px solid rgba(148,163,184,.35); border-radius: 8px; }
    aside section { margin-bottom: 12px; padding: 12px; background: #151b25; border: 1px solid #283447; border-radius: 8px; }
    form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    input { width: 100%; background: #020617; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li { color: #cbd5e1; font-size: 13px; }
    .queue-item { width: 100%; min-height: 0; display: grid; grid-template-columns: auto minmax(0,1fr); gap: 8px; align-items: center; text-align: left; padding: 8px; background: #0f172a; }
    .queue-item strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queue-index { color: #86efac; font-variant-numeric: tabular-nums; }
    .error { color: #fecaca; margin-top: 8px; font-size: 13px; }
    .download { min-height: 38px; width: 40px; display: inline-grid; place-items: center; border-radius: 6px; border: 1px solid #475569; background: #172033; color: #e5edf5; text-decoration: none; }
    body.focus-mode main { grid-template-columns: 1fr; }
    body.focus-mode aside, body.focus-mode header, body.focus-mode .meta { display: none; }
    body.focus-mode .player { height: 100vh; }
    body.focus-mode .room-tabs, body.focus-mode .meta { opacity: .18; transition: opacity .15s ease; }
    body.focus-mode .room-tabs:hover, body.focus-mode .meta:hover { opacity: 1; }
  </style>
  <script src="/api/activity/hls"></script>
</head>
<body>
  <main>
    <section class="player">
      <header>
        <div>
          <p class="muted">Discord Watch Requests</p>
          <h1 id="room">Room ${escapeHtml(requestedSessionId)}</h1>
        </div>
        <div class="status" id="activity-status">Loading</div>
      </header>
      <div class="video-wrap">
        <video id="video" class="${isAudioOnly || isEmbeddedVideo ? 'hidden' : ''}" controls autoplay muted playsinline ${nativeSrc ? `src="${escapeHtml(nativeSrc)}"` : ''}></video>
        <iframe id="youtube" class="youtube-player ${isEmbeddedVideo ? '' : 'hidden'}" ${iframeSrc ? `src="${escapeHtml(iframeSrc)}"` : ''} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        <audio id="audio" class="audio-player ${isAudioOnly ? '' : 'hidden'}" controls autoplay ${audioSrc ? `src="${escapeHtml(audioSrc)}"` : ''}></audio>
        <div class="empty ${current ? 'hidden' : ''}" id="empty"><strong>No video loaded</strong><span>Use the request panel or type !wr in Discord.</span></div>
      </div>
      <nav class="room-tabs" aria-label="Watch rooms">
        <button class="room-tab" data-session-switch="${GLOBAL_WATCH_SESSION_ID}" type="button">Movies</button>
        <button class="room-tab" data-session-switch="${MUSIC_WATCH_SESSION_ID}" type="button">Music</button>
      </nav>
      <div class="toolbar" aria-label="Watch controls">
        <button data-action="local-play" title="Play locally">Play</button>
        <button data-action="sync-local" title="Sync to live position">Sync</button>
        <button id="popout" type="button" disabled>Pop Out</button>
        <button id="fullscreen" type="button">Fullscreen</button>
        <button class="panel-btn" data-panel="request" type="button">Request</button>
        <button class="panel-btn" data-panel="queue" type="button">Queue</button>
        <button class="panel-btn" data-panel="events" type="button">Activity</button>
        <button id="media-mode" type="button" hidden>Video</button>
        <button class="icon-btn" id="mute" type="button" title="Mute" aria-label="Mute">🔊</button>
        <div class="volume" title="Volume">
          <input id="volume" type="range" min="0" max="100" value="85" aria-label="Video volume" />
          <span id="volume-label">85%</span>
        </div>
        <button class="icon-btn" id="download" type="button" disabled title="Download" aria-label="Download">⇩</button>
      </div>
      <div class="meta">
        <strong id="title">${escapeHtml(title)}</strong>
        <p class="muted" id="media">${escapeHtml(media)}</p>
        <p class="error" id="error"></p>
      </div>
    </section>
    <aside id="drawer" class="sr-only" aria-hidden="true">
      <section data-panel-section="request" class="active">
        <h2>Add Video</h2>
        <form id="request-form">
          <input id="query" placeholder="Try Big Buck Bunny, Sintel, HLS" />
          <button type="submit">Request</button>
        </form>
        <button id="accept-recommendation" type="button" disabled style="display:none;margin-top:8px;width:100%;">Add Recommended Match</button>
      </section>
      <section data-panel-section="queue" class="active">
        <h2>Queue</h2>
        <ul id="queue"><li>Queue is empty.</li></ul>
      </section>
      <section data-panel-section="events" class="active">
        <h2>Activity</h2>
        <ul id="events"><li>No events yet.</li></ul>
      </section>
    </aside>
  </main>
  <script>
${activityJs(DISCORD_CLIENT_ID, requestedSessionId)}
  </script>
</body>
</html>`;
}

export async function GET(request: Request) {
  return new NextResponse(html(request), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
