'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const bridge = read('worker/src/discord-voice-bridge.js');
const workerServer = read('worker/src/server.js');
const bootstrap = read('worker/src/persona-bootstrap.js');
const api = read('src/app/api/discord/voice-bridge/route.ts');
const ui = read('src/app/rooms/[roomId]/_components/VoiceBridgeCard.tsx');
const dockerfile = read('worker/Dockerfile');
const audioStatePatch = read('worker/scripts/patch-voice-bridge-audio-state.cjs');
const peerRegistry = read('src/app/api/peer-voice/register/route.ts');
const peerVoiceService = read('src/lib/peer-audio-service.ts');
const middleware = read('src/middleware.ts');

test('browser, persona worker, and Discord bridge prefer the same LiveKit project URL', () => {
  assert.match(workerServer, /const BRIDGE_LIVEKIT_URL =[\s\S]{0,200}process\.env\.NEXT_PUBLIC_LIVEKIT_URL\s*\|\|\s*process\.env\.LIVEKIT_URL/);
  assert.match(bootstrap, /process\.env\.NEXT_PUBLIC_LIVEKIT_URL\s*\|\|\s*process\.env\.LIVEKIT_URL/);
});

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

test('DJ worker listens on Fly private IPv6 while retaining IPv4-compatible public health checks', () => {
  const server = read('worker/src/server.js');
  assert.match(server, /WORKER_ROLE === 'dj'\s*\?\s*\(requestedBindHost && requestedBindHost !== '0\.0\.0\.0' \? requestedBindHost : '::'\)/);
  assert.match(server, /ipv6Only: false/);
  assert.match(server, /app\.listen\(LISTEN_OPTIONS/);
  assert.match(api, /dj\.process\.hmo-dj-worker\.internal:3002/);
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


test('Discord bridge falls back to PeerJS when LiveKit is unavailable', () => {
  assert.match(bridge, /async startPeerPublisher\(\)/);
  assert.match(bridge, /this\.peerAudioSource\.onData\(/);
  assert.match(bridge, /hmo-zdiscord-/);
  assert.match(bridge, /DISCORD_BRIDGE_TRANSPORT \\|\\| 'peerjs'/);
  assert.match(bridge, /Explicit LiveKit setup failed; switching to PeerJS/);
  assert.match(bridge, /this\.stopped \|\| this\.liveKitCleanupInProgress \|\| this\.peerFallback/);
  assert.match(bridge, /RTCAudioSink/);
  assert.match(bridge, /transport: this\.peerFallback \? 'peerjs' : 'livekit'/);
  assert.match(peerRegistry, /isDjWorkerRequest/);
  assert.match(peerRegistry, /fromDjWorker/);
  assert.match(peerRegistry, /reserved for the voice bridge/);
  assert.match(peerRegistry, /Only the authenticated worker can unregister the voice bridge/);
  assert.doesNotMatch(peerRegistry, /Streaming rooms use LiveKit voice/);
  assert.match(peerVoiceService, /this\._peerId\.localeCompare\(remotePeerId\) > 0/);
  assert.match(peerVoiceService, /this\.peer\.call\(remotePeerId, this\.localStream\)/);
  assert.match(ui, /PeerJS fallback/);
});

test('PeerJS signaling reaches its own room-access guard without requiring SPMT middleware first', () => {
  assert.match(middleware, /'\/api\/peer-voice\/'/);
  assert.match(peerRegistry, /requireRoomVoiceAccess\(roomId\)/);
});

test('the voice-bridge API does not invite or join Athena/persona bots', () => {
  assert.doesNotMatch(api, /\/api\/bots\/session|\/persona|athena/i);
});

test('bridge server/channel dropdowns and secondary switches are collapsed behind accessible icon controls', () => {
  assert.match(ui, /showConnectionSettings && \(/);
  assert.match(ui, /aria-label="Discord server and channel settings"/);
  assert.match(ui, /showAdvancedSettings && \(/);
  assert.match(ui, /aria-label="Discord bridge secondary settings"/);
  assert.match(ui, /setBridge\(checked\)/);
});
