import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { sharedPlayerScript } from '../src/lib/shared-player-script';
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
    '/api/watch/stream/music/index.m3u8?requestId=one', '/api/watch/stream/movie/init.mp4?requestId=two', '/api/watch/stream/movie/seg_123.m4s?requestId=two',
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

function playerContext(href = 'https://1279582181768957963.discordsays.com/activity?frame_id=frame-123') {
  // Evaluate the actual generated browser program, without importing server
  // services or connecting to Discord/YouTube during regression tests.
  const js = sharedPlayerScript('1279582181768957963', 'discord-music-room', 'https://hearmeout-main.fly.dev');
  new vm.Script(js);
  const element: any = { value: '100', dataset: {}, textContent: '', style: {}, classList: { toggle() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; } };
  const messages: any[] = [];
  const location = new URL(href);
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
  assert.equal(media, '/.proxy/api/watch/youtube/hls/abcdefghijk/index.m3u8');
  assert.equal(vm.runInContext("JSON.stringify(apiUrls('/api/watch/sessions/discord-music-room/state'))", context),
    '["/.proxy/api/watch/sessions/discord-music-room/state"]');
  assert.equal(vm.runInContext("typeof shouldResolveYoutubeInBrowser", context), "undefined");
});

test('Activity routes API and same-app media URLs through the proxy exactly once', () => {
  const { context } = playerContext();
  for (const path of [
    '/api/watch/sessions/discord-music-room/state',
    '/api/watch/sessions/discord-music-room/request',
    '/api/watch/sessions/discord-music-room/quick-control?action=play',
    '/activity-provider/xtream/hls/vod-123/index.m3u8',
    '/api/youtube-audio/abcdefghijk',
  ]) {
    for (const input of [path, '/.proxy' + path, 'https://hearmeout-main.fly.dev' + path]) {
      assert.equal(vm.runInContext(`appUrl(${JSON.stringify(input)})`, context), '/.proxy' + path);
    }
  }
  for (const external of ['https://www.youtube.com/embed/abcdefghijk', 'data:audio/mpeg;base64,AA', 'blob:https://example.com/audio']) {
    assert.equal(vm.runInContext(`appUrl(${JSON.stringify(external)})`, context), external);
  }
  const browser = playerContext('https://hearmeout-main.fly.dev/activity');
  assert.equal(vm.runInContext("appUrl('/api/watch/sessions/discord-music-room/state')", browser.context), '/api/watch/sessions/discord-music-room/state');
});

test('state and request calls use the mapped endpoint without replaying mutations', async () => {
  const { context } = playerContext();
  const requests: any[] = [];
  context.fetch = async (url: string, options: any) => {
    requests.push({ url, options });
    // Reproduce Discord returning its HTML shell on an unmapped /api route.
    if (!url.startsWith('/.proxy/')) return new Response('<!DOCTYPE html><html>Discord</html>', { headers: { 'content-type': 'text/html' } });
    return Response.json({ id: 'discord-music-room', queue: [] });
  };
  const state = await vm.runInContext("api('/api/watch/sessions/discord-music-room/state')", context);
  assert.equal(state.id, 'discord-music-room');
  await vm.runInContext("api('/api/watch/sessions/discord-music-room/request', {method:'POST', body:JSON.stringify({query:'test song'})})", context);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/.proxy/api/watch/sessions/discord-music-room/request');
  assert.equal(requests[1].options.body, '{"query":"test song"}');
});

test('HTML and malformed JSON responses produce a useful error without another request', async () => {
  for (const [contentType, body] of [['text/html', '<!DOCTYPE html><html>Discord</html>'], ['application/json', '{broken']]) {
    const { context } = playerContext();
    let calls = 0;
    context.fetch = async () => {
      calls++;
      return new Response(body, { headers: { 'content-type': contentType } });
    };
    await assert.rejects(vm.runInContext("api('/api/watch/sessions/discord-music-room/request', {method:'POST', body:'{}'})", context), /could not connect through Discord/);
    assert.equal(calls, 1);
  }
});

test('JSON API errors retain their status and recommendation payload', async () => {
  const { context } = playerContext();
  context.fetch = async () => Response.json({ error: 'No matching item', recommendation: { title: 'Try this' } }, { status: 404 });
  await assert.rejects(vm.runInContext("api('/api/watch/sessions/discord-music-room/request')", context), (error: any) => {
    assert.equal(error.status, 404);
    assert.equal(error.payload.recommendation.title, 'Try this');
    return true;
  });
});

test('initial Activity HTML loads its media library through Discord while browser URLs stay direct', async () => {
  const source = readFileSync(new URL('../src/app/activity/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(compiled, { exports, URL, process: { env: {} }, require(name: string) {
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/lib/public-config') return { DISCORD_CLIENT_ID: '1279582181768957963' };
    if (name === '@/lib/watch-session') return { GLOBAL_WATCH_SESSION_ID: 'discord-watch-room', MUSIC_WATCH_SESSION_ID: 'discord-music-room' };
    if (name === '@/lib/watch-request-service') return { getDefaultActivitySessionId: () => 'discord-music-room', getResolvedWatchSession: () => ({ current: null }), getPublicWatchSession: (state: any) => state };
    if (name === '@/lib/activity-room') return { ensureDiscordActivityRoom: async () => {} };
    if (name === '../activity-lite.js/route') return { js: () => '' };
    throw new Error('Unexpected import ' + name);
  } });
  for (const [url, path] of [
    ['https://hearmeout-main.fly.dev/activity?frame_id=f', '/.proxy/api/activity/hls'],
    ['https://1279582181768957963.discordsays.com/activity', '/.proxy/api/activity/hls'],
    ['https://hearmeout-main.fly.dev/activity', '/api/activity/hls'],
  ]) {
    const html = await (await exports.GET(new Request(url))).text();
    assert.ok(html.includes(`<script src="${path}"></script>`), url);
  }
});
