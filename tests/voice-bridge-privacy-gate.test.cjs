'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const bridge = read('worker/src/discord-voice-bridge.js');
const bootstrap = read('worker/src/persona-bootstrap.js');
const api = read('src/app/api/discord/voice-bridge/route.ts');
const ui = read('src/app/rooms/[roomId]/_components/VoiceBridgeCard.tsx');
const dockerfile = read('worker/Dockerfile');
const audioStatePatch = read('worker/scripts/patch-voice-bridge-audio-state.cjs');

test('worker starts privacy-safe and gates only the HearMeOut voice lane', () => {
  assert.match(bridge, /roomVoiceOutboundEnabled = false/);
  assert.match(bridge, /sourceKey\.startsWith\('voice:'\)/);
  assert.match(bridge, /if \(isRoomVoice && !this\.roomVoiceOutboundEnabled\)/);
  assert.match(bridge, /src\.buf = Buffer\.alloc\(0\)/);
  assert.match(bridge, /discordMixTick\(\)/);
  assert.match(bridge, /\['voice'\]|'voice'/);
  assert.match(bridge, /'music'/);
});

test('worker exposes an authenticated privacy gate without coupling bridge start to personas', () => {
  assert.match(bootstrap, /app\.post\('\/voice-bridge\/gate'/);
  assert.match(bootstrap, /authorize/);
  assert.match(bootstrap, /setVoiceBridgeRoomOutbound/);

  const bridgeStartBlock = bridge.slice(bridge.indexOf('async function startVoiceBridge'), bridge.indexOf('async function stopVoiceBridge'));
  assert.doesNotMatch(bridgeStartBlock, /persona|athena/i);
});

test('worker authentication never falls back to a repository-embedded development secret', () => {
  const server = read('worker/src/server.js');
  const bootstrap = read('worker/src/persona-bootstrap.js');
  for (const source of [server, bootstrap]) {
    assert.match(source, /process\.env\.HMO_WORKER_SHARED_SECRET/);
    assert.doesNotMatch(source, /LOCAL_DEV_WORKER_SECRET/);
  }
});

test('main app preserves explicit privacy choices but migrates legacy rooms to two-way audio', () => {
  assert.match(api, /typeof raw\.roomVoiceOutboundEnabled === 'boolean'/);
  assert.match(api, /\? raw\.roomVoiceOutboundEnabled\s*\n?\s*: true/);
  assert.match(api, /action === 'set-room-outbound'/);
  assert.match(api, /callWorker\('\/voice-bridge\/gate'/);
  assert.match(api, /Bridge privacy gate could not be confirmed/);
});

test('room UI follows live worker outbound state instead of a stale browser toggle', () => {
  assert.match(ui, /applyWorkerState/);
  assert.match(ui, /worker\?\.roomVoiceOutboundEnabled/);
  assert.match(ui, /setRoomVoiceOutboundEnabled\(worker\.roomVoiceOutboundEnabled\)/);
  assert.match(ui, /Let Discord hear this room/);
  assert.match(ui, /Listen-only: Discord stays audible here, but this room stays private/);
});

test('worker build reports real Discord mute state and handles Stage suppression', () => {
  assert.match(dockerfile, /patch-voice-bridge-audio-state\.cjs/);
  assert.match(audioStatePatch, /discordSelfMute/);
  assert.match(audioStatePatch, /discordServerMute/);
  assert.match(audioStatePatch, /discordSuppressed/);
  assert.match(audioStatePatch, /setSuppressed\(false\)/);
});

test('the voice-bridge API does not invite or join Athena/persona bots', () => {
  assert.doesNotMatch(api, /\/api\/bots\/session|\/persona|athena/i);
});
