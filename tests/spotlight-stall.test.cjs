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
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 119000 }), false);
  assert.equal(shouldRecycleSpotlight({ stalled: true, playlistAgeMs: 120000 }), true);
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
test('Spotlight preserves a short stall, then replaces the stuck encoder once', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { EventEmitter } = require('node:events');
  let now = 1000000, modifiedAt = now, resolves = 0, spawned = [];
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
      Object.assign(child, { exitCode: null, killed: false, stderr: new EventEmitter(),
        kill() { this.killed = true; } });
      spawned.push(child);
      return child;
    },
  };
  const sandbox = { module: { exports: {} }, Date: { now: () => now }, Math,
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:child_process') return fakeChild;
      return require(name);
    },
    fetch: async () => ({ ok: true, json: async () => ({ spotlight: { twitchLogin: 'captain' } }) }),
    AbortSignal, setInterval: () => 1, setTimeout: () => ({ unref() {} }),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../worker/src/spotlight-hls'), 'utf8'), sandbox);
  const worker = sandbox.module.exports.createSpotlightHls({ spotlightEndpoint: 'https://example.com/directory' });
  await worker.start();
  assert.equal(resolves, 1);
  assert.equal(worker.status().recoveryCount, 0);
  now += 21000;
  await worker.start();
  assert.equal(spawned.length, 1, 'short stalls preserve the Twitch session');
  now = modifiedAt + 120000;
  await worker.start();
  assert.equal(spawned.length, 2, 'two minutes without progress replaces the encoder');
  assert.equal(spawned[0].killed, true);
  assert.equal(worker.status().recoveryCount, 1);
  modifiedAt = now;
  await worker.start();
  assert.equal(spawned.length, 2, 'a healthy replacement is not repeatedly restarted');
});
