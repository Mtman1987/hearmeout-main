import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { GET as legacyEntry } from '../src/app/activity-lite/route';

test('Discord opens without a website cookie and keeps its launch parameters', async () => {
  const query = '?frame_id=frame-123&platform=desktop&sessionId=music&instance_id=instance-456';
  const response = await middleware(new NextRequest('https://activity.discordsays.com/' + query));
  const target = new URL(response.headers.get('x-middleware-rewrite')!);
  assert.equal(target.pathname, '/activity');
  assert.equal(target.search, query);
  assert.equal(target.origin, 'https://activity.discordsays.com');
  const legacy = await legacyEntry(new Request('https://activity.discordsays.com/activity-lite' + query));
  assert.equal(legacy.headers.get('location'), '/activity' + query);
});

test('shared Activity player, queue, controls, and media bypass browser login', async () => {
  for (const path of [
    '/activity', '/activity?sessionId=music', '/activity-lite', '/activity-lite.js',
    '/api/watch/activity-default', '/api/activity/hls', '/activity-hls',
    '/api/watch/sessions/discord-music-room/state',
    '/api/watch/sessions/discord-watch-room/state',
    '/api/watch/sessions/watch-discord-123-456-music/state',
    '/api/watch/sessions/discord-music-room/state?mediaVideoId=abcdefghijk&mediaFile=source.webm',
    '/api/watch/sessions/discord-music-room/quick-control?action=play',
    '/activity-state/discord-music-room',
    '/activity/session/discord-music-room/state',
    '/api/watch/youtube/hls/abcdefghijk/source.webm',
    '/api/watch/xtream/hls/vod-123/index.m3u8',
  ]) {
    const response = await middleware(new NextRequest('https://hmo.test' + path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    assert.equal(response.headers.get('location'), null, path);
  }
  for (const path of ['/api/watch/sessions/discord-music-room/request', '/api/watch/sessions/discord-music-room/control', '/activity-request/discord-music-room/accept']) {
    const response = await middleware(new NextRequest('https://hmo.test' + path, { method: 'POST' }));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
  }
});

test('Activity exceptions keep account, private sessions, uploads, and worker controls protected', async () => {
  for (const path of ['/', '/admin', '/activity?sessionId=watch-room-private-music', '/activity-lite.js?sessionId=watch-room-private-music',
    '/api/watch/sessions/watch-room-private-music/state', '/api/watch/sessions/watch-room-private-music/control',
    '/api/watch/youtube/upload', '/api/watch/youtube/resolve', '/activity-worker/control', '/api/settings/admin',
    '/activity-admin', '/api/watch/sessions/discord-music-room/settings']) {
    const response = await middleware(new NextRequest('https://hmo.test' + path));
    assert.equal(response.headers.get('x-middleware-next'), null, path);
    assert.equal(response.status, path.startsWith('/api/') ? 401 : 307, path);
  }
});

function playerContext() {
  // Evaluate the actual generated browser program, without importing server
  // services or connecting to Discord/YouTube during regression tests.
  const source = readFileSync(new URL('../src/app/activity-lite.js/route.ts', import.meta.url), 'utf8');
  const generator = source.slice(source.indexOf('export function js'), source.indexOf('\nexport async function GET')).replace('export function', 'function');
  const compiled = ts.transpileModule(generator, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const js = vm.runInNewContext(compiled + '\njs("1279582181768957963", "discord-music-room", "https://hearmeout-main.fly.dev")');
  new vm.Script(js);
  const element: any = { value: '100', dataset: {}, textContent: '', style: {}, classList: { toggle() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; } };
  const messages: any[] = [];
  const location = new URL('https://1279582181768957963.discordsays.com/activity?frame_id=frame-123');
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, console,
    location, navigator: { userAgent: 'test' },
    window: { location, parent: { postMessage(...args: any[]) { messages.push(args); } }, addEventListener() {} },
    document: { referrer: 'https://discord.com/channels/123/456', getElementById() { return { ...element }; },
      querySelectorAll() { return []; }, addEventListener() {}, body: element },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch() { return new Promise(() => {}); },
  });
  vm.runInContext(js, context);
  return { context, messages };
}

test('generated player starts Discord handshake and uses shared same-origin playback', () => {
  const { context, messages } = playerContext();
  assert.equal(messages[0][0][0], 0);
  assert.equal(messages[0][0][1].frame_id, 'frame-123');
  assert.equal(messages[0][1], 'https://discord.com');
  const media = vm.runInContext("appUrl('/api/watch/youtube/hls/abcdefghijk/index.m3u8')", context);
  assert.equal(media, '/api/watch/sessions/discord-music-room/state?mediaVideoId=abcdefghijk&mediaFile=source.webm');
  assert.equal(vm.runInContext("JSON.stringify(apiUrls('/api/watch/sessions/discord-music-room/state'))", context),
    '["/api/watch/sessions/discord-music-room/state"]');
  assert.equal(vm.runInContext("shouldResolveYoutubeInBrowser({id:'youtube-abcdefghijk', metadata:{playbackStrategy:'proxy'}})", context), false);
});
