'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const jitter = require('../worker/src/discord-pcm-jitter');

function loadBridge() {
  const filename = path.resolve(__dirname, '../worker/src/discord-voice-bridge.js');
  const context = {
    module: { exports: {} }, Buffer, process, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === 'stream') return require('node:stream');
      if (name === './discord-pcm-jitter') return jitter;
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testBridge = VoiceBridge; module.exports.testBridges = bridges;', context, { filename });
  return context.module.exports;
}

function loadRoutes(bridge) {
  const source = fs.readFileSync(path.resolve(__dirname, '../worker/src/server.js'), 'utf8');
  const region = source.slice(source.indexOf("app.post('/voice-bridge',"), source.indexOf('// ── Health ─'));
  const routes = new Map();
  const authorizeWorker = (_req, _res, next) => next();
  const context = {
    app: { post(url, ...handlers) { assert.equal(handlers[0], authorizeWorker); routes.set(`POST ${url}`, handlers[1]); }, get() {} },
    authorizeWorker, ...bridge, BRIDGE_LIVEKIT_URL: 'wss://fixture.invalid', APP_URL: 'https://fixture.invalid', WORKER_CALLBACK_HEADERS: {},
    resolveDiscordBotToken: async () => 'fixture-token', console,
  };
  vm.runInNewContext(region, context);
  async function request(url, body) {
    let status = 200, payload;
    const res = { status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
    await routes.get(`POST ${url}`)({ body }, res);
    return { status, payload };
  }
  return request;
}

function pcmFrames(count, value) {
  const bytes = Buffer.alloc(3840 * count);
  for (let offset = 0; offset < bytes.length; offset += 2) bytes.writeInt16LE(value, offset);
  return bytes;
}

test('gain changes reach already-buffered real PCM without applying gain twice', () => {
  const source = new jitter.DiscordPcmJitterSource({ frameBytes: 3840, channels: 2 });
  source.push(pcmFrames(10, 10000), 1000);
  source.nextFrame(1000);
  source.setOutputGain(0.6);
  assert.equal(source.nextFrame(1020).readInt16LE(1000), 6000);
  source.setOutputGain(0.2);
  assert.equal(source.nextFrame(1040).readInt16LE(1000), 2000);
  assert.equal(source.setOutputGain(9).outputGain, 1);
  assert.equal(source.setOutputGain(0).outputGain, 0.05);
  assert.throws(() => source.setOutputGain(NaN), /finite/);
});

test('worker start and update routes preserve nondefault gain and report it from the running bridge', async () => {
  const bridge = loadBridge();
  bridge.testBridge.prototype.start = async function () {};
  const request = loadRoutes(bridge);
  const started = await request('/voice-bridge', { action: 'start', roomId: 'room-a', guildId: '12345', voiceChannelId: '54321', discordReceiveGain: 0.7 });
  assert.equal(started.status, 200); assert.equal(started.payload.status.discordReceiveGain, 0.7);
  const active = bridge.testBridges.get('room-a');
  const source = new jitter.DiscordPcmJitterSource({ frameBytes: 3840, outputGain: active.discordReceiveGain });
  active.discordMixSources.set('speaker', source);
  source.push(pcmFrames(10, 10000), 1000); source.nextFrame(1000);
  const updated = await request('/voice-bridge/receive-gain', { roomId: 'room-a', discordReceiveGain: 0.6 });
  assert.equal(updated.payload.status.discordReceiveGain, 0.6);
  assert.equal(source.nextFrame(1020).readInt16LE(1000), 6000);
  const again = await request('/voice-bridge', { action: 'start', roomId: 'room-a', guildId: '12345', voiceChannelId: '54321', discordReceiveGain: 0.4 });
  assert.equal(again.payload.status.discordReceiveGain, 0.4);
  assert.equal(source.outputGain, 0.4);
});

test('old callers retain the default and malformed gain never starts a bridge', async () => {
  const bridge = loadBridge(); let starts = 0;
  bridge.testBridge.prototype.start = async function () { starts++; };
  const request = loadRoutes(bridge);
  const started = await request('/voice-bridge', { action: 'start', roomId: 'old-room', guildId: '12345', voiceChannelId: '54321' });
  assert.equal(started.payload.status.discordReceiveGain, 0.32);
  for (const discordReceiveGain of ['0.6', null, Infinity]) {
    assert.equal((await request('/voice-bridge', { action: 'start', roomId: 'bad-room', guildId: '12345', voiceChannelId: '54321', discordReceiveGain })).status, 400);
    assert.equal((await request('/voice-bridge/receive-gain', { roomId: 'old-room', discordReceiveGain })).status, 400);
  }
  assert.equal(starts, 1);
});

test('stop waits for a delayed start and removes the bridge before reporting success', async () => {
  const bridge = loadBridge();
  let finishStart;
  const pending = new Promise(resolve => { finishStart = resolve; });
  let enteredStart;
  const entered = new Promise(resolve => { enteredStart = resolve; });
  let stops = 0, stopSettled = false;
  bridge.testBridge.prototype.start = () => { enteredStart(); return pending; };
  bridge.testBridge.prototype.stop = async function () { stops++; };
  const request = loadRoutes(bridge);
  const starting = request('/voice-bridge', { action: 'start', roomId: 'delayed-room', guildId: '12345', voiceChannelId: '54321' });
  await entered;
  const stopping = request('/voice-bridge', { action: 'stop', roomId: 'delayed-room' }).then(result => { stopSettled = true; return result; });
  await Promise.resolve();
  assert.equal(stopSettled, false);
  const unrelated = await request('/voice-bridge', { action: 'stop', roomId: 'other-room' });
  assert.equal(unrelated.payload.success, true);
  finishStart();
  await starting;
  assert.equal((await stopping).payload.success, true);
  assert.equal(stops, 1);
  assert.equal(bridge.testBridges.has('delayed-room'), false);
});

test('stop during a failed start observes cleanup without leaking the provider rejection', async () => {
  const bridge = loadBridge();
  let rejectStart;
  const pending = new Promise((_resolve, reject) => { rejectStart = reject; });
  let enteredStart;
  const entered = new Promise(resolve => { enteredStart = resolve; });
  let stops = 0;
  bridge.testBridge.prototype.start = () => { enteredStart(); return pending; };
  bridge.testBridge.prototype.stop = async function () { stops++; };
  bridge.testBridge.prototype.markStopCooldown = () => {};
  const request = loadRoutes(bridge);
  const starting = request('/voice-bridge', { action: 'start', roomId: 'failed-room', guildId: '12345', voiceChannelId: '54321' });
  await entered;
  const stopping = request('/voice-bridge', { action: 'stop', roomId: 'failed-room' });
  rejectStart(new Error('fixture provider refused startup'));
  assert.equal((await starting).status, 500);
  assert.equal((await stopping).payload.success, true);
  assert.equal(stops, 1);
  assert.equal(bridge.testBridges.has('failed-room'), false);
});

test('one guild cannot be claimed by a second room during startup or while connected', async () => {
  const bridge = loadBridge();
  let finishStart, enteredStart;
  const pending = new Promise(resolve => { finishStart = resolve; });
  const entered = new Promise(resolve => { enteredStart = resolve; });
  bridge.testBridge.prototype.start = function () {
    if (this.roomId === 'first') { enteredStart(); return pending; }
    return Promise.resolve();
  };
  bridge.testBridge.prototype.stop = async function () {};
  const opts = { guildId: '12345', voiceChannelId: '54321' };
  const first = bridge.startVoiceBridge({ ...opts, roomId: 'first' });
  await entered;
  await assert.rejects(bridge.startVoiceBridge({ ...opts, roomId: 'second', voiceChannelId: '65432' }), /already connected to another/);
  assert.equal((await bridge.startVoiceBridge({ ...opts, guildId: '23456', roomId: 'unrelated' })).success, true);
  finishStart();
  await first;
  await assert.rejects(bridge.startVoiceBridge({ ...opts, roomId: 'second' }), /already connected to another/);
  await bridge.stopVoiceBridge('first');
  assert.equal((await bridge.startVoiceBridge({ ...opts, roomId: 'second' })).success, true);
});

test('failed provider startup releases the guild claim for another room', async () => {
  const bridge = loadBridge();
  bridge.testBridge.prototype.start = async function () {
    if (this.roomId === 'failed') throw new Error('fixture connection failed');
  };
  bridge.testBridge.prototype.stop = async function () {};
  bridge.testBridge.prototype.markStopCooldown = () => {};
  const opts = { guildId: '12345', voiceChannelId: '54321' };
  await assert.rejects(bridge.startVoiceBridge({ ...opts, roomId: 'failed' }), /fixture connection failed/);
  assert.equal((await bridge.startVoiceBridge({ ...opts, roomId: 'replacement' })).success, true);
});
