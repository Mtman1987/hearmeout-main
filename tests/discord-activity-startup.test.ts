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
    '/api/watch/sessions/discord-music-room/state?mediaVideoId=abcdefghijk&mediaFile=source.webm&lane=activity',
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
  const source = readFileSync(new URL('../src/app/activity-lite.js/route.ts', import.meta.url), 'utf8');
  const generator = source.slice(source.indexOf('export function js'), source.indexOf('\nexport async function GET')).replace('export function', 'function');
  const compiled = ts.transpileModule(generator, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const js = vm.runInNewContext(compiled + '\njs("1279582181768957963", "discord-music-room", "https://hearmeout-main.fly.dev")');
  new vm.Script(js);
  const element: any = { value: '100', dataset: {}, textContent: '', style: {}, classList: { toggle() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; } };
  const messages: any[] = [];
  const documentEvents = new Map<string, Function[]>();
  const elements = new Map<string, any>();
  const location = new URL(href);
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, console,
    location, navigator: { userAgent: 'test' },
    window: { location, parent: { postMessage(...args: any[]) { messages.push(args); } }, addEventListener() {} },
    document: { referrer: 'https://discord.com/channels/123/456', getElementById(id: string) { if (!elements.has(id)) elements.set(id, { ...element, handlers: new Map<string, Function>(), addEventListener(name: string, callback: Function) { this.handlers.set(name, callback); } }); return elements.get(id); },
      querySelectorAll() { return []; }, addEventListener(name: string, callback: Function) { documentEvents.set(name, [...(documentEvents.get(name) || []), callback]); }, body: element },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    fetch() { return new Promise(() => {}); },
  });
  vm.runInContext(js, context);
  return { context, messages, documentEvents, elements };
}

test('generated player starts Discord handshake and uses shared same-origin playback', () => {
  const { context, messages } = playerContext();
  assert.equal(messages[0][0][0], 0);
  assert.equal(messages[0][0][1].frame_id, 'frame-123');
  assert.equal(messages[0][1], 'https://discord.com');
  const media = vm.runInContext("appUrl('/api/watch/youtube/hls/abcdefghijk/index.m3u8')", context);
  assert.equal(media, '/.proxy/api/watch/sessions/discord-music-room/state?mediaVideoId=abcdefghijk&mediaFile=source.webm&lane=activity');
  assert.equal(vm.runInContext("JSON.stringify(apiUrls('/api/watch/sessions/discord-music-room/state'))", context),
    '["/.proxy/api/watch/sessions/discord-music-room/state"]');
  assert.equal(vm.runInContext("shouldResolveYoutubeInBrowser({id:'youtube-abcdefghijk', metadata:{playbackStrategy:'proxy'}})", context), false);
});

test('a growing movie playlist cannot advance the shared queue at its buffer edge', () => {
  const { context } = playerContext();
  const timers: Array<() => void> = [];
  context.setTimeout = (callback: () => void) => { timers.push(callback); return 1; };
  vm.runInContext(`
    state = {current:{requestId:'akira',item:{title:'Akira',type:'movie'}},playback:{status:'playing',position:198,updatedAt:Date.now()}};
    media.duration=18; media.currentTime=18;
    let nextCalls=0, resumes=0;
    control=async()=>{nextCalls++;};
    startVideoPlayback=()=>Promise.resolve(true);
    hls={currentLevel:0,levels:[{details:{live:true}}],startLoad(){resumes++;}};
    onMediaEnded({currentTarget:media});
  `, context);
  assert.equal(vm.runInContext('nextCalls', context), 0);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(vm.runInContext('resumes', context), 1);
  assert.equal(vm.runInContext('media.currentTime', context), 17.75);
  vm.runInContext(`hls.levels[0].details.live=false; onMediaEnded({currentTarget:media});`, context);
  assert.equal(vm.runInContext('nextCalls', context), 1);
});

test('stale stream recovery cannot resume a replacement movie', () => {
  const { context } = playerContext();
  let retry: () => void = () => {};
  context.setTimeout = (callback: () => void) => { retry = callback; return 1; };
  vm.runInContext(`state={current:{requestId:'old',item:{title:'Old'}}}; let resumes=0;
    hls={currentLevel:0,levels:[{details:{live:true}}],startLoad(){resumes++;}};
    onMediaEnded({currentTarget:media}); state.current.requestId='new';`, context);
  retry();
  assert.equal(vm.runInContext('resumes', context), 0);
});

test('idle controls hide after a tap despite the button retaining focus', () => {
  const { context } = playerContext();
  let timer: () => void = () => {};
  let delay = 0;
  const added: string[] = [];
  context.document.body.classList.add = (value: string) => added.push(value);
  context.document.activeElement = { closest: () => true };
  context.setTimeout = (callback: () => void, ms: number) => { timer = callback; delay = ms; return 1; };
  vm.runInContext('scheduleControlsHide()', context);
  assert.equal(delay, 2500);
  timer();
  assert.deepEqual(added, ['controls-hidden']);
});

test('mobile volume uses local gain and changes without affecting shared playback', async () => {
  const { context } = playerContext('https://hearmeout-main.fly.dev/activity');
  const gain = { value: 1 };
  let sources = 0;
  context.window.AudioContext = class {
    state = 'running';
    destination = {};
    createGain() { return { gain, connect() {} }; }
    createMediaElementSource() { sources++; return { connect() {} }; }
    resume() { return Promise.resolve(); }
  };
  vm.runInContext(`state={current:{item:{type:'movie'}},playback:{volume:85}};
    enableLocalAudioGain(); muted=false; volumeInput.value='25'; applyVolume();`, context);
  assert.equal(gain.value, 0.25);
  assert.equal(vm.runInContext('media.volume', context), 1);
  assert.equal(vm.runInContext('state.playback.volume', context), 85);
  vm.runInContext(`volumeInput.value='0';applyVolume();enableLocalAudioGain();`, context);
  assert.equal(gain.value, 0);
  assert.equal(sources, 2);
});

test('pending recommendations use distinct viewer identities', () => {
  const first = playerContext();
  const second = playerContext();
  assert.notEqual(vm.runInContext('ACTIVITY_REQUESTER_ID', first.context), vm.runInContext('ACTIVITY_REQUESTER_ID', second.context));
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
      assert.equal(vm.runInContext(`appUrl(${JSON.stringify(input)})`, context), '/.proxy' + path + (path.includes('/hls/') ? '?lane=activity' : ''));
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
    if (name === '@/lib/watch/watch-request-service') return { getDefaultActivitySessionId: () => 'discord-music-room', getResolvedWatchSession: () => ({ current: null }), getPublicWatchSession: (state: any) => state };
    if (name === '@/lib/activity-room') return { ensureDiscordActivityRoom: async () => {} };
    if (name === '../activity-lite.js/route') return { js: () => '' };
    throw new Error('Unexpected import ' + name);
  } });
  for (const [url, path] of [
    ['https://hearmeout-main.fly.dev/activity?frame_id=f', '/.proxy/api/activity/hls?v=full-audio-20261007'],
    ['https://1279582181768957963.discordsays.com/activity', '/.proxy/api/activity/hls?v=full-audio-20261007'],
    ['https://hearmeout-main.fly.dev/activity', '/api/activity/hls?v=full-audio-20261007'],
  ]) {
    const html = await (await exports.GET(new Request(url))).text();
    assert.ok(html.includes(`<script src="${path}"></script>`), url);
  }
});

test('audible autoplay is attempted first and blocked playback recovers without changing the queue', async () => {
  const { context } = playerContext();
  vm.runInContext("state={current:{requestId:'same-movie'},playback:{status:'playing',volume:85}};media.readyState=4", context);
  let calls=0;
  context.attempt = () => {
    calls++;
    assert.equal(vm.runInContext('media.muted', context), false);
    if(calls===1) return Promise.reject(Object.assign(new Error('gesture required'),{name:'NotAllowedError'}));
    return Promise.resolve();
  };
  vm.runInContext('media.play=attempt',context);
  assert.equal(await vm.runInContext('startVideoPlayback()',context),false);
  assert.equal(vm.runInContext('enableSoundBtn.hidden',context),false);
  assert.equal(await vm.runInContext('startVideoPlayback()',context),true);
  assert.equal(vm.runInContext('enableSoundBtn.hidden',context),false);
  assert.equal(vm.runInContext('state.current.requestId',context),'same-movie');
  vm.runInContext('muted=true',context);
  context.attempt=()=>Promise.resolve();
  vm.runInContext('media.play=attempt',context);
  await vm.runInContext('startVideoPlayback()',context);
  assert.equal(vm.runInContext('media.muted',context),true);
});

test('source failures are not reported as an autoplay permission block', async () => {
  const {context}=playerContext();
  context.failPlay=()=>Promise.reject(Object.assign(new Error('source failed'),{name:'NotSupportedError'}));
  vm.runInContext("state={current:{requestId:'movie'}};media.readyState=4;media.play=failPlay",context);
  await vm.runInContext('startVideoPlayback()',context);
  assert.equal(vm.runInContext('autoplayBlocked',context),false);
});

test('suspended volume processor never takes audio away from the native player', async () => {
  const {context}=playerContext('https://hearmeout-main.fly.dev/activity');
  let sources=0;
  let release: Function = () => {};
  context.window.AudioContext=class {
    state='suspended';
    destination={};
    createGain(){return {gain:{value:1},connect(){}};}
    createMediaElementSource(){sources++;return {connect(){}};}
    resume(){return new Promise(resolve=>{release=()=>{this.state='running';resolve(undefined);};});}
  };
  const pending=vm.runInContext('enableLocalAudioGain()',context);
  assert.equal(sources,0);
  assert.equal(vm.runInContext('localAudioSources.has(media)',context),false);
  release();
  await pending;
  assert.equal(sources,2);
});


test('audio activation uses sound controls without a movie tap', async () => {
  const {context,documentEvents,elements}=playerContext();
  let plays=0;
  context.playNow=()=>{plays++;return Promise.resolve();};
  vm.runInContext("state={current:{requestId:'same'},playback:{status:'playing'}};media.readyState=4;media.play=playNow;muted=false;volumeInput.value='85'",context);
  assert.equal(documentEvents.has('click'),false);
  assert.equal(documentEvents.has('touchend'),false);
  elements.get('mute').handlers.get('click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vm.runInContext('media.muted',context),false);
  assert.equal(plays,1);
  elements.get('mute').handlers.get('click')();
  assert.equal(vm.runInContext('media.muted',context),true);
  vm.runInContext("volumeInput.value='0'",context);
  elements.get('enable-sound').handlers.get('click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vm.runInContext('media.muted',context),false);
  assert.equal(vm.runInContext('volumeInput.value',context),'85');
  assert.equal(vm.runInContext('state.current.requestId',context),'same');
});

test('playing video keeps the sound prompt when its connected output is suspended', async () => {
  const {context}=playerContext();
  context.playNow=()=>Promise.resolve();
  vm.runInContext("state={current:{requestId:'same'}};media.readyState=4;media.play=playNow;localAudioContext={state:'suspended'};localAudioSources.set(media,{});localAudioGain={gain:{value:1}}",context);
  await vm.runInContext('startVideoPlayback()',context);
  assert.match(vm.runInContext('enableSoundBtn.textContent',context),/retry/);
  vm.runInContext("localAudioContext.state='running';updateSoundPrompt()",context);
  assert.equal(vm.runInContext('enableSoundBtn.hidden',context),false);
});

test('Discord volume stays on native output and sound button invokes play while loading', async () => {
  const {context,elements}=playerContext();
  let contexts=0, plays=0;
  context.window.AudioContext=class { constructor(){contexts++;} };
  context.playNow=()=>{plays++;return Promise.resolve();};
  vm.runInContext("state={current:{requestId:'same'},playback:{status:'playing'}};media.readyState=0;media.play=playNow;volumeInput.value='85';muted=true",context);
  elements.get('volume').handlers.get('input')();
  assert.equal(contexts,0);
  elements.get('enable-sound').handlers.get('click')();
  assert.equal(plays,1);
  assert.equal(vm.runInContext('media.muted',context),false);
  await new Promise(resolve=>setImmediate(resolve));
});

test('audio diagnostics pass middleware only for POST in public shared sessions', async () => {
  const allowed=await middleware(new NextRequest('https://hmo.test/api/activity/audio-report?sessionId=discord-watch-room',{method:'POST'}));
  assert.equal(allowed.headers.get('x-middleware-next'),'1');
  for (const [sessionId,method] of [['watch-room-private-movie','POST'],['discord-watch-room','GET']]) {
    const response=await middleware(new NextRequest('https://hmo.test/api/activity/audio-report?sessionId='+sessionId,{method}));
    assert.equal(response.status,401);
  }
});

test('public audio reports log only bounded playback diagnostics', async () => {
  const source=readFileSync(new URL('../src/app/api/activity/audio-report/route.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={}, logs:any[]=[];
  vm.runInNewContext(compiled,{exports,Response,URL,Date,Number,console:{info(...args:any[]){logs.push(args);}},require(name:string){
    if(name==='next/server')return {NextResponse:Response};
    if(name==='@/lib/activity-access')return {isPublicActivityRequest:(url:URL)=>url.searchParams.get('sessionId')==='discord-watch-room'};
    throw new Error(name);
  }});
  const post=(body:string,sessionId='discord-watch-room')=>exports.POST(new Request('https://hmo.test/api/activity/audio-report?sessionId='+sessionId,{method:'POST',body}));
  assert.equal((await post(JSON.stringify({event:'audio unlock',muted:false,volume:0.85,audioTracks:1,userAgent:'test',secret:'discard'}))).status,204);
  const report=JSON.parse(logs[0][1]);
  assert.equal(report.muted,false);
  assert.equal(report.audioTracks,1);
  assert.equal(report.secret,undefined);
  assert.equal((await post('{}','private')).status,403);
  assert.equal((await post('{bad')).status,400);
  assert.equal((await post('x'.repeat(4097))).status,413);
});

test('Activity HLS bundle includes separate audio-track controllers', async () => {
  const source=readFileSync(new URL('../src/app/activity-hls/route.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};
  vm.runInNewContext(compiled,{exports,process:{cwd:()=>'/app'},require(name:string){
    if(name==='node:fs/promises')return {readFile:async(path:string)=>{assert.equal(path,'/app/node_modules/hls.js/dist/hls.min.js');return 'full bundle';}};
    if(name==='node:path')return {join:(...parts:string[])=>parts.join('/')};
    if(name==='next/server')return {NextResponse:Response};
    throw new Error(name);
  }});
  const response=await exports.GET();
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(await response.text(),'full bundle');
});

test('movie startup waits for a buffer and never speeds up to chase the clock', async () => {
  const {context,elements}=playerContext();
  let plays=0;
  context.playNow=()=>{plays++;return Promise.resolve();};
  vm.runInContext("state={current:{requestId:'movie',item:{type:'movie'}},playback:{status:'playing'}};hls={levels:[{details:{live:true}}],currentLevel:0};media.currentTime=0;media.duration=100;media.readyState=4;media.play=playNow;media.buffered={length:1,start:()=>0,end:()=>6}",context);
  assert.equal(await vm.runInContext('startVideoPlayback()',context),false);
  assert.equal(plays,0);
  assert.equal(elements.get('loading-splash').hidden,false);
  assert.match(elements.get('loading-message').textContent,/Warming/);
  vm.runInContext('media.buffered.end=()=>18',context);
  assert.equal(await vm.runInContext('startVideoPlayback()',context),true);
  assert.equal(plays,1);
  assert.equal(elements.get('loading-splash').hidden,true);
  assert.equal(vm.runInContext("driftPlaybackRate(600,{type:'movie'},1.08)",context),1);
  vm.runInContext('media.currentTime=7;updateSeekUi()',context);
  assert.match(elements.get('position-label').textContent,/^0:07/);
});

test('Activity playlist URLs carry lane without moving normal browser playback', () => {
  const {context}=playerContext();
  assert.equal(vm.runInContext("appUrl('/api/watch/xtream/hls/vod-123/index.m3u8?machine=old')",context),'/.proxy/api/watch/xtream/hls/vod-123/index.m3u8?machine=old&lane=activity');
});
