const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function viewer() {
  const handlers = {}, intervals = [], players = [];
  let ahead = 8, progress = 40, generation = 'one', plays = 0;
  const video = {
    paused: true, ended: false, readyState: 4, currentTime: 100, autoplay: true,
    buffered: { length: 1, start: () => 100, end: () => 100 + ahead },
    addEventListener: (event, handler) => { handlers[event] = handler; },
    play: async () => { plays++; video.paused = false; },
    pause: () => { video.paused = true; }, removeAttribute() {}, load() {},
  };
  const status = {}, audioButton = { addEventListener() {} };
  class Hls {
    static Events = { ERROR: 'error', MEDIA_ATTACHED: 'attached' };
    static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
    static isSupported() { return true; }
    constructor(config) { this.config = config; this.handlers = {}; players.push(this); }
    on(event, callback) { this.handlers[event] = callback; }
    attachMedia() {} loadSource() {} destroy() { this.destroyed = true; }
    startLoad(position) { this.resumePosition = position; }
  }
  const html = fs.readFileSync(require('node:path').join(__dirname, '../public/lounge-media/worker-media.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => id === 'player' ? video : id === 'status' ? status : audioButton },
    window: { Hls, addEventListener() {} }, Hls, AbortSignal,
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); },
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/lounge/media/program')
      ? { movie: { current: { requestId: 'movie', item: { title: 'Movie' } }, playback: { status: 'playing', position: progress } } }
      : url.endsWith('/lounge/direct/status') ? { ready: true, requestId: 'movie', generation, streamKey: 'movie-' + generation }
      : { levels: { media: 85, all: 100 } } }),
  });
  await new Promise(setImmediate);
  return { video, handlers, players, status, get plays() { return plays; },
    buffer: seconds => { ahead = seconds; }, save: () => { progress += 60; },
    poll: async () => { await intervals.find(t => t.ms === 2500).callback(); },
    seek: () => { generation = 'two'; }, Hls };
}

test('movie starts automatically only with a safety buffer, at normal speed without a live-edge deadline', async () => {
  const v = await viewer();
  assert.equal(v.plays, 0);
  assert.equal(v.video.autoplay, false, 'native autoplay cannot bypass the safety buffer');
  v.buffer(16); await v.handlers.canplay();
  assert.equal(v.plays, 1);
  const config = v.players[0].config;
  assert.equal(config.maxLiveSyncPlaybackRate, 1);
  assert.equal(config.liveMaxLatencyDurationCount, Infinity);
  assert.equal(config.maxBufferLength, 60);
  assert.equal(config.maxMaxBufferLength, 90);
});
test('a checkpoint keeps the current player and position; only a changed stream generation replaces it', async () => {
  const v = await viewer();
  v.buffer(30); await v.handlers.canplay();
  v.save(); await v.poll();
  assert.equal(v.players.length, 1);
  assert.equal(v.video.currentTime, 100);
  assert.equal(v.video.paused, false);
  v.seek(); await v.poll();
  assert.equal(v.players.length, 2);
  assert.equal(v.players[0].destroyed, true);
});
test('a drained movie buffer waits to refill and a network retry retains the viewer position', async () => {
  const v = await viewer();
  v.buffer(30); await v.handlers.canplay();
  v.buffer(1); v.handlers.waiting();
  assert.equal(v.video.paused, true);
  v.buffer(8); await v.handlers.progress();
  assert.equal(v.video.paused, true);
  v.buffer(16); await v.handlers.progress();
  assert.equal(v.video.paused, false);
  v.players[0].handlers.error(null, { fatal: true, type: v.Hls.ErrorTypes.NETWORK_ERROR });
  assert.equal(v.players[0].resumePosition, 100);
  assert.equal(v.players.length, 1);
});
