const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSpotlightPlaylist, shouldRecycleSpotlight } = require('../worker/src/spotlight-hls');
const { spotlightTimestampFilter, inspectSpotlightCommercial } = require('../worker/src/spotlight-hls');

const playlist = durations => '#EXTM3U\n' + durations.map((duration, index) =>
  '#EXTINF:' + duration + ',\nseg_' + String(index).padStart(6, '0') + '.ts\n').join('');

test('Spotlight treats a fresh progressing HLS playlist as playable', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 4]), 3000),
    { segmentCount: 3, stalled: false });
});

test('Spotlight exposes only a current stitched ad marker and its relay expiry', () => {
  const now = Date.parse('2026-10-02T08:00:10Z');
  const marker = '#EXT-X-DATERANGE:ID="ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-10-02T08:00:00Z",DURATION=30,X-SECRET="signed-url"';
  assert.deepEqual(inspectSpotlightCommercial(marker, now), {
    id: 'ad-1', breakStartedAt: now - 10000, activeUntil: now + 32000,
  });
  assert.equal(inspectSpotlightCommercial(marker, now + 32000), null);
  assert.equal(inspectSpotlightCommercial(marker.replace('DURATION=30', 'PLANNED-DURATION=30'), now)?.id, 'ad-1');
  assert.equal(inspectSpotlightCommercial(marker.replace('twitch-stitched-ad', 'other'), now), null);
  assert.equal(inspectSpotlightCommercial(marker.replace('DURATION=30', 'DURATION=NaN'), now), null);
  assert.equal(inspectSpotlightCommercial(marker, now - 20000), null);
});

test('Spotlight stream copy repairs a large presentation clock jump with audio intact', t => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  if (spawnSync('ffmpeg', ['-version']).error?.code === 'ENOENT') {
    t.skip('ffmpeg is required for the packet-clock integration check'); return;
  }
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'spotlight-clock-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  function run(args) {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeout: 30000 });
    assert.equal(result.status, 0, String(result.stderr));
  }
  const input = path.join(folder, 'jump.ts');
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120', '-c:a', 'aac',
    '-bsf:v', "setts=pts='PTS+gte(N,120)*1000/TB'", '-f', 'mpegts', input]);
  const output = path.join(folder, 'index.m3u8');
  run(['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    '-bsf:v', spotlightTimestampFilter(), '-bsf:a', spotlightTimestampFilter(true),
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '20', output]);
  const durations = [...fs.readFileSync(output, 'utf8').matchAll(/#EXTINF:([\d.]+)/g)].map(m => Number(m[1]));
  assert.ok(durations.length >= 3);
  assert.ok(Math.max(...durations) < 6, JSON.stringify(durations));
  assert.ok(Math.abs(durations.reduce((a, b) => a + b, 0) - 12) < 1);
  // Decode both tracks, rather than accepting a healthy-looking manifest alone.
  run(['-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
});

test('Spotlight rejects Twitch timestamp jumps even with eight segments', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 5213.499]), 1000),
    { segmentCount: 3, stalled: true });
});

test('Spotlight rejects segments that stopped arriving', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 4]), 21000),
    { segmentCount: 3, stalled: true });
});


test('Spotlight keeps one Twitch session through a temporary preroll stall', () => {
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 21000 }), false);
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 29000 }), false);
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 30000 }), true);
});

test('Spotlight allows healthy long keyframe chunks while they are progressing', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 20, 20]), 21000),
    { segmentCount: 3, stalled: false });
  assert.equal(inspectSpotlightPlaylist(playlist([20, 20]), 41000).stalled, true);
});

test('Spotlight recovers a stuck initial encoder and a repeatedly corrupt timeline', () => {
  assert.equal(inspectSpotlightPlaylist('', 121000).stalled, true);
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 1000, stalledForMs: 120000 }), true);
  assert.equal(shouldRecycleSpotlight({ stalled: false, playlistAgeMs: 1000, stalledForMs: 120000 }), false);
});
test('Spotlight waits through one preroll and reuses its session for stall recovery', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { EventEmitter } = require('node:events');
  let now = 1000000, modifiedAt = now, resolves = 0, spawned = [], preroll = true;
  const marker = '#EXT-X-DATERANGE:ID="ad",CLASS="twitch-stitched-ad",START-DATE="' + new Date(now).toISOString() + '",DURATION=30';
  const fakeFs = {
    existsSync: () => true,
    mkdirSync() {}, rmSync() {}, createReadStream() {},
    readFileSync: () => playlist([4, 4, 4]),
    statSync: () => ({ mtimeMs: modifiedAt }),
  };
  const fakeChild = {
    execFile(_cmd, _args, _opts, cb) { resolves++; cb(null, { stdout: 'https://example.com/live.m3u8' }); },
    spawn() {
      const child = new EventEmitter();
      Object.assign(child, { exitCode: null, killed: false, stderr: { resume() {} },
        kill() { this.killed = true; } });
      spawned.push(child);
      return child;
    },
  };
  const sandbox = { module: { exports: {} }, Date: { now: () => now, parse: Date.parse }, Math,
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:child_process') return fakeChild;
      return require(name);
    },
    fetch: async () => ({ ok: true, json: async () => ({ spotlight: { twitchLogin: 'captain' } }), text: async () => preroll ? marker : '' }),
    AbortSignal, setInterval: () => 1, setTimeout: () => ({ unref() {} }),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../worker/src/spotlight-hls'), 'utf8'), sandbox);
  const worker = sandbox.module.exports.createSpotlightHls({ spotlightEndpoint: 'https://example.com/directory' });
  await worker.start();
  assert.equal(resolves, 1);
  assert.equal(spawned.length, 0, 'preroll must finish before opening the encoder');
  assert.equal(worker.status().commercialBreak.active, true);
  now += 20000;
  await worker.start();
  assert.equal(resolves, 1, 'pending preroll keeps the original Twitch session');
  assert.equal(spawned.length, 0);
  now += 30000; preroll = false; modifiedAt = now;
  await worker.start();
  assert.equal(spawned.length, 1);
  assert.equal(resolves, 1);
  assert.equal(worker.status().recoveryCount, 0);
  now += 21000;
  await worker.start();
  assert.equal(spawned.length, 1, 'short stalls preserve the Twitch session');
  now = modifiedAt + 30000;
  await worker.start();
  assert.equal(spawned.length, 2, 'thirty seconds without progress replaces the encoder');
  assert.equal(spawned[0].killed, true);
  assert.equal(worker.status().recoveryCount, 1);
  assert.equal(resolves, 1, 'recovery must not resolve a new session with another preroll');
  now += 31000;
  await worker.start();
  assert.equal(spawned.length, 3, 'a second stalled encoder is replaced');
  assert.equal(resolves, 2, 'repeated failure obtains a fresh Twitch session');
  modifiedAt = now;
  await worker.start();
  assert.equal(spawned.length, 3, 'a healthy replacement is not repeatedly restarted');
});

test('an empty directory is not reported as stalled video', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const sandbox = { module: { exports: {} }, Date: { now: () => 200000 },
    require(name) {
      if (name === 'node:fs') return { existsSync: () => false };
      return require(name);
    },
    fetch: async () => ({ ok: true, json: async () => ({ spotlight: null }) }),
    AbortSignal, setInterval: () => 1, setTimeout,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../worker/src/spotlight-hls'), 'utf8'), sandbox);
  const worker = sandbox.module.exports.createSpotlightHls({ spotlightEndpoint: 'https://example.com/directory' });
  const status = await worker.start();
  assert.equal(status.active, false);
  assert.equal(status.stalled, false);
  assert.equal(status.error, 'No live community Spotlight is available');
});

test('the viewer preserves buffered playback through a short same-source stall', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  let program = { active: true, ready: true, generation: 'same', currentLogin: 'captain' };
  let destroyed = 0; const timers = [];
  const video = { paused: false, readyState: 4, muted: false, currentTime: 10,
    buffered: { length: 1, start: () => 0, end: () => 40 },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }, load() {}, removeAttribute() {},
    addEventListener() {}, canPlayType() { return ''; },
  };
  class Hls {
    static isSupported() { return true; }
    static Events = { ERROR: 'error', MEDIA_ATTACHED: 'attached' };
    destroy() { destroyed++; } on() {} attachMedia() {} loadSource() {}
  }
  const nodes = { player: video, status: { hidden: false }, 'enable-audio': { hidden: true, addEventListener() {} } };
  const context = { Hls, window: { Hls, parent: { postMessage() {} }, addEventListener() {} },
    document: { getElementById: id => nodes[id] }, AbortSignal, console,
    fetch: async url => ({ ok: true, json: async () => String(url).includes('/spotlight/program') ? program : { levels: { spotlight: 80 } } }),
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return 1; },
  };
  const html = fs.readFileSync(require('node:path').join(__dirname, '../public/spotlight-media/worker-spotlight.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>\n([\s\S]*?)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, 0);
  program = { ...program, ready: false, stalled: true };
  await timers.find(t => t.ms === 2500).fn();
  assert.equal(destroyed, 0, 'a temporary stall does not discard already buffered video');
  assert.equal(video.paused, false);
  program = { ...program, active: false };
  await timers.find(t => t.ms === 2500).fn();
  assert.equal(destroyed, 0, 'a reconnecting source keeps its playable buffer');
  program = { ...program, currentLogin: '', generation: '' };
  await timers.find(t => t.ms === 2500).fn();
  assert.equal(destroyed, 1, 'an explicitly removed Spotlight source is released');
});

test('Spotlight buffers before autoplay and recovers network/media errors without discarding video', async () => {
  const vm=require('node:vm'),fs=require('node:fs');
  let ahead=4;const handlers={},players=[];
  const video={paused:true,readyState:4,currentTime:100,
    buffered:{length:1,start:()=>100,end:()=>100+ahead},
    addEventListener:(event,fn)=>{handlers[event]=fn;},
    play:async()=>{video.paused=false;},pause:()=>{video.paused=true;},load(){},removeAttribute(){},canPlayType(){return '';}};
  class Hls{
    static isSupported(){return true;}
    static Events={ERROR:'error',MEDIA_ATTACHED:'attached'};
    static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};
    constructor(config){this.config=config;this.events={};players.push(this);}
    on(event,fn){this.events[event]=fn;}attachMedia(){}loadSource(){}
    destroy(){this.destroyed=true;}startLoad(position){this.position=position;}
    recoverMediaError(){this.recovered=true;}
  }
  const nodes={player:video,status:{},'enable-audio':{addEventListener(){}}};
  const html=fs.readFileSync(require('node:path').join(__dirname,'../public/spotlight-media/worker-spotlight.html'),'utf8');
  vm.runInNewContext(html.match(/<script>\n([\s\S]*?)<\/script>/)[1],{
    Hls,window:{Hls,parent:{postMessage(){}},addEventListener(){}},AbortSignal,setInterval(){},
    document:{getElementById:id=>nodes[id]},
    fetch:async url=>({ok:true,json:async()=>url.endsWith('/spotlight/program')?{ready:true,generation:'one',currentLogin:'captain'}:{levels:{spotlight:80}}}),
  });
  await new Promise(setImmediate);
  assert.equal(video.paused,true);
  assert.doesNotMatch(html,/<video[^>]*autoplay/);
  ahead=12;await handlers.canplay();assert.equal(video.paused,false);
  assert.equal(players[0].config.maxLiveSyncPlaybackRate,1);
  assert.equal(players[0].config.liveMaxLatencyDurationCount,Infinity);
  players[0].events.error(null,{fatal:true,type:'network'});
  assert.equal(players[0].position,100);assert.equal(players[0].destroyed,undefined);
  players[0].events.error(null,{fatal:true,type:'media'});
  assert.equal(players[0].recovered,true);
  ahead=1;handlers.waiting();assert.equal(video.paused,true);
  ahead=8;await handlers.progress();assert.equal(video.paused,true);
  ahead=12;await handlers.progress();assert.equal(video.paused,false);
});
