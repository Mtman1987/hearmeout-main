import { NextResponse } from 'next/server';

function html(clientId: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Discord Stream Hub Activity</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { margin: 0; background: #05070a; color: #e5edf5; font-family: Arial, system-ui, sans-serif; }
    main { width: 100vw; height: 100vh; overflow: hidden; }
    .panel { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
    header, .meta, aside section { padding: 12px; }
    header { position: absolute; z-index: 5; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 12px; align-items: center; background: linear-gradient(180deg, rgba(5,7,10,.92), rgba(5,7,10,.64) 72%, rgba(5,7,10,0)); pointer-events: none; }
    header > * { pointer-events: auto; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 16px; }
    h2 { font-size: 15px; margin-bottom: 10px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .video-wrap { position: absolute; inset: 0; background: #000; }
    video { width: 100%; height: 100%; background: #000; display: block; object-fit: contain; }
    .empty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: #cbd5e1; gap: 8px; background: rgba(0,0,0,.28); }
    button, input { min-height: 38px; border-radius: 6px; border: 1px solid #475569; background: #172033; color: #e5edf5; padding: 8px 10px; }
    button { cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:hover { border-color: #34d399; }
    input { width: 100%; background: #020617; }
    .room-label { min-width: 0; }
    .room-label .muted { margin-bottom: 2px; }
    .toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .icon-btn { width: 40px; min-width: 40px; height: 38px; padding: 0; display: inline-grid; place-items: center; font-size: 16px; }
    .panel-btn.active { border-color: #34d399; color: #bbf7d0; }
    .volume { width: 160px; display: flex; align-items: center; gap: 8px; border: 1px solid #475569; border-radius: 6px; background: #0f172a; padding: 7px 9px; }
    .volume input { min-height: 0; padding: 0; accent-color: #34d399; }
    .download { min-height: 38px; width: 40px; display: inline-grid; place-items: center; border-radius: 6px; border: 1px solid #475569; background: #172033; color: #e5edf5; text-decoration: none; }
    .download:hover { border-color: #34d399; }
    aside { position: absolute; z-index: 6; top: 62px; right: 12px; width: min(360px, calc(100vw - 24px)); max-height: calc(100vh - 78px); overflow: auto; display: none; }
    aside.open { display: block; }
    aside section { display: none; background: rgba(15, 23, 42, .96); border: 1px solid #334155; border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.45); }
    aside section.active { display: block; }
    form { display: grid; gap: 8px; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li { color: #cbd5e1; font-size: 13px; border-top: 1px solid #263241; padding-top: 8px; }
    .status { color: #86efac; border: 1px solid rgba(52,211,153,.5); border-radius: 999px; padding: 5px 10px; font-size: 13px; white-space: nowrap; }
    .error { color: #fecaca; margin-top: 8px; font-size: 13px; }
    .meta { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; background: linear-gradient(0deg, rgba(5,7,10,.88), rgba(5,7,10,.58) 70%, rgba(5,7,10,0)); transition: opacity .16s ease; }
    body.focus-mode header { background: rgba(5,7,10,.5); }
    body.focus-mode .meta, body.focus-mode aside { display: none; }
    @media (max-width: 850px) {
      header { align-items: flex-start; padding: 8px; }
      .toolbar { gap: 6px; }
      .icon-btn, .download { width: 36px; min-width: 36px; height: 36px; }
      .volume { width: 128px; }
      .room-label .muted { display: none; }
      h1 { font-size: 13px; max-width: 28vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }
  </style>
  <script src="/activity-hls"></script>
</head>
<body>
  <main>
    <section class="panel">
      <header>
        <div class="room-label">
          <p class="muted">Discord Watch Requests</p>
          <h1 id="room">Room</h1>
        </div>
        <div class="toolbar" aria-label="Watch controls">
          <button class="icon-btn" data-action="play" title="Play" aria-label="Play">▶</button>
          <button class="icon-btn" data-action="pause" title="Pause" aria-label="Pause">Ⅱ</button>
          <button class="icon-btn" data-action="seek" title="Sync" aria-label="Sync">↻</button>
          <button class="icon-btn" data-action="next" title="Next" aria-label="Next">⏭</button>
          <button class="icon-btn" data-action="clear" title="Clear" aria-label="Clear">×</button>
          <button class="icon-btn" id="fullscreen" type="button" title="Focus video" aria-label="Focus video">⛶</button>
          <button class="icon-btn" id="popout" type="button" disabled title="Pop out" aria-label="Pop out">↗</button>
          <button class="icon-btn panel-btn" data-panel="request" type="button" title="Request" aria-label="Request">＋</button>
          <button class="icon-btn panel-btn" data-panel="queue" type="button" title="Queue" aria-label="Queue">☰</button>
          <button class="icon-btn panel-btn" data-panel="events" type="button" title="Activity" aria-label="Activity">ⓘ</button>
          <button class="icon-btn" id="mute" type="button" title="Mute" aria-label="Mute">🔊</button>
          <div class="volume" title="Volume">
            <input id="volume" type="range" min="0" max="100" value="85" aria-label="Video volume" />
            <span id="volume-label">85%</span>
          </div>
          <button class="icon-btn" id="download" type="button" disabled title="Download" aria-label="Download">⇩</button>
          <div class="status" id="activity-status">Loading</div>
        </div>
      </header>
      <div class="video-wrap">
        <video id="video" controls playsinline></video>
        <div class="empty" id="empty"><strong>No video loaded</strong><span>Type !wr in Discord or use the request box.</span></div>
      </div>
      <div class="meta">
        <strong id="title">Waiting for a request</strong>
        <p class="muted" id="media">Media: idle</p>
      </div>
      <aside id="drawer">
        <section data-panel-section="request">
          <h2>Test Request</h2>
          <form id="request-form">
            <input id="query" placeholder="Try Big Buck Bunny, Sintel, HLS" />
            <button type="submit">Request</button>
          </form>
          <p class="error" id="error"></p>
        </section>
        <section data-panel-section="queue">
          <h2>Queue</h2>
          <ul id="queue"><li>Queue is empty.</li></ul>
        </section>
        <section data-panel-section="events">
          <h2>Activity</h2>
          <ul id="events"><li>No events yet.</li></ul>
        </section>
      </aside>
    </section>
  </main>
  <script src="/activity-lite.js?v=${Date.now()}" defer></script>
</body>
</html>`;
}

export async function GET() {
  return new NextResponse(html(process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || ''), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
