const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSpotlightPlaylist, shouldRecycleSpotlight } = require('../worker/src/spotlight-hls');

const playlist = durations => '#EXTM3U\n' + durations.map((duration, index) =>
  '#EXTINF:' + duration + ',\nseg_' + String(index).padStart(6, '0') + '.ts\n').join('');

test('Spotlight treats a fresh progressing HLS playlist as playable', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 4]), 3000),
    { segmentCount: 3, stalled: false });
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
      Object.assign(child, { exitCode: null, killed: false, stderr: { resume() {} },
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
