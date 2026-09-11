import { NextResponse } from 'next/server';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { getDefaultActivitySessionId } from '@/lib/watch-request-service';
import { ensureDiscordActivityRoom } from '@/lib/activity-room';
import { js } from '../activity-lite.js/route';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const discord = Boolean(url.searchParams.get('frame_id')) || url.hostname.endsWith('.discordsays.com');
  // Ordinary player views never create a voice room. Only an actual Discord
  // launch uses the optional Activity voice-room integration.
  if (discord) await ensureDiscordActivityRoom();
  const sessionId = getDefaultActivitySessionId(url.searchParams.get('sessionId') || url.searchParams.get('session_id'));
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const script = js(DISCORD_CLIENT_ID, sessionId, base).replace(/<\/script/gi, '<\\/script');
  return new NextResponse(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HearMeOut</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#080d16;color:#edf2f7;font:14px system-ui,sans-serif}main{height:100%;display:flex;flex-direction:column;gap:10px;padding:12px}nav{display:flex;gap:8px}button,input{font:inherit;color:inherit;background:#182335;border:1px solid #40516a;border-radius:6px;padding:8px}button{cursor:pointer}button[aria-pressed=true]{border-color:#64d9cb}button:disabled{opacity:.5}video{width:100%;min-height:80px;flex:1;background:#000;object-fit:contain;pointer-events:none}#title{font-weight:600}#activity-status{font-size:12px;color:#acbdd3}.volume{display:flex;gap:10px;align-items:center}.volume input{flex:1;accent-color:#64d9cb}.volume output{min-width:3em}form{display:flex;gap:8px}form input{flex:1;min-width:0}details{max-height:25%;overflow:auto}ul{padding-left:20px}#error{color:#ffb6b6;font-size:12px}button[hidden]{display:none}
</style><script src="${escapeHtml((discord ? '/.proxy' : '') + '/api/activity/hls')}"></script>
</head><body><main>
<nav aria-label="Media"><button data-session-switch="movie">Movies</button><button data-session-switch="music">Music</button></nav>
<video id="video" autoplay playsinline disablepictureinpicture disableremoteplayback></video>
<div id="title">Waiting for a request</div><div id="activity-status" role="status">Connecting</div>
<label class="volume">My volume<input id="volume" aria-label="My volume" type="range" min="0" max="100" step="1" value="85"><output id="volume-label">85%</output></label>
<form id="request-form"><input id="query" aria-label="Song or movie request" placeholder="Request a song or movie" autocomplete="off"><button id="request-button" type="submit">Request</button></form>
<div id="error" role="alert"></div><button id="accept-recommendation" hidden></button>
<details><summary>Queue</summary><ul id="queue"></ul></details>
</main><script>${script}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
