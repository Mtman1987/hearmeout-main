const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, readFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { SharedMediaRelay } = require('../worker/src/shared-media-relay');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fakeProcess() {
  const child = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = () => { child.emit('close', 0); return true; };
  return child;
}

test('concurrent rooms share one producer per kind; obsolete requests cannot replace it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-relay-'));
  let spawned = 0; let active = 0; let maxActive = 0;
  const current = { music: 'song-a', movie: 'movie-a' };
  const relay = new SharedMediaRelay({ root, validateSource: async (kind, id) => current[kind] === id,
    resolveSource: async () => { await delay(5); return { inputs: [{ url: 'fixture' }] }; }, onEnded: async () => {},
    spawnProcess() { spawned++; active++; maxActive = Math.max(maxActive, active); const p = fakeProcess(); p.once('close', () => active--); return p; },
  });
  t.after(async () => { await relay.close(); rmSync(root, { recursive: true, force: true }); });
  const slots = await Promise.all(Array.from({ length: 30 }, () => relay.ensure('music', 'song-a')));
  assert.equal(new Set(slots).size, 1); assert.equal(spawned, 1);
  await relay.ensure('movie', 'movie-a'); assert.equal(active, 2);
  current.music = 'song-b'; await relay.ensure('music', 'song-b');
  assert.equal(active, 2); assert.equal(maxActive, 2);
  await assert.rejects(relay.ensure('music', 'song-a'), /Source changed/);
  assert.equal(spawned, 3); assert.equal(await relay.file('music', 'song-a', 'init.mp4'), null);
  assert.equal(await relay.file('music', 'song-b', '../index.m3u8'), null);
});

test('failed resolution is deduplicated and completion delivery retries instead of freezing the queue', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-relay-fail-'));
  let resolutions = 0; let callbacks = 0;
  const relay = new SharedMediaRelay({ root, completionDelayMs: 5, retryDelayMs: 5,
    resolveSource: async () => { resolutions++; throw new Error('provider unavailable'); },
    onEnded: async (_kind, id, error) => { assert.equal(id, 'bad'); assert.ok(error); if (++callbacks < 3) throw new Error('network'); },
  });
  t.after(async () => { await relay.close(); rmSync(root, { recursive: true, force: true }); });
  await Promise.all(Array.from({ length: 20 }, () => relay.ensure('music', 'bad')));
  const deadline = Date.now() + 2000;
  while (callbacks < 3 && Date.now() < deadline) await delay(10);
  assert.equal(resolutions, 1); assert.equal(callbacks, 3);
});

test('real ffmpeg emits one paced, bounded fMP4 stream for concurrent listeners', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-relay-real-'));
  const fixture = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture]);
  let producers = 0;
  const relay = new SharedMediaRelay({ root: join(root, 'relay'), segmentSeconds: 1, segments: 3,
    resolveSource: async () => ({ inputs: [{ url: fixture }] }), onEnded: async () => {},
    spawnProcess(...args) { producers++; return spawn(...args); },
  });
  t.after(async () => { await relay.close(); rmSync(root, { recursive: true, force: true }); });
  const started = Date.now();
  const viewers = await Promise.all(Array.from({ length: 5 }, () => relay.ensure('movie', 'one')));
  assert.equal(producers, 1); assert.ok(viewers.every(slot => slot === viewers[0]));
  let media;
  while (!media && Date.now() - started < 10000) { await delay(100); media = await relay.file('movie', 'one', 'index.m3u8'); }
  assert.ok(media, 'manifest produced'); assert.ok(Date.now() - started >= 900, 'producer is paced');
  const first = readFileSync(media.path, 'utf8'); assert.match(first, /EXT-X-MAP:URI="init.mp4"/);
  assert.match(first, /seg_\d+\.m4s/);
  const firstSequence = Number(first.match(/EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]);
  while (Date.now() - started < 9000) await delay(100);
  const latest = readFileSync(media.path, 'utf8');
  assert.ok(Number(latest.match(/EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]) > firstSequence);
  assert.ok(latest.split('\n').filter(line => line.endsWith('.m4s')).length <= 3);
  assert.ok(readdirSync(viewers[0].dir).filter(file => file.endsWith('.m4s')).length <= 7);
  assert.equal(producers, 1); assert.equal(viewers[0].finished, false);
});
