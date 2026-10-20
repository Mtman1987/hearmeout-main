'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const overlay = fs.readFileSync(path.join(root, 'src/app/overlay/voices/[roomId]/page.tsx'), 'utf8');
const peersRoute = fs.readFileSync(path.join(root, 'src/app/api/peer-voice/peers/route.ts'), 'utf8');
const registerRoute = fs.readFileSync(path.join(root, 'src/app/api/peer-voice/register/route.ts'), 'utf8');

test('silent PeerJS sender track stays alive until the overlay is disposed', () => {
  const createStream = overlay.indexOf('silentStream = destination.stream');
  const register = overlay.indexOf('const register = async () =>', createStream);
  assert.notEqual(createStream, -1, 'overlay must create its silent sender stream');
  assert.notEqual(register, -1, 'overlay must register after PeerJS signaling opens');

  const setup = overlay.slice(createStream, register);
  assert.doesNotMatch(setup, /oscillator\.stop\(\)|context\.close\(\)/,
    'closing the AudioContext before calls are negotiated ends the silent sender track');
  assert.match(overlay, /if \(silentContext\) void silentContext\.close\(\)\.catch\(\(\) => \{\}\)/,
    'the AudioContext must still be closed during component cleanup');
});

test('overlay authenticates both presence registration and peer discovery with sourceKey', () => {
  assert.match(overlay, /body: JSON\.stringify\(\{ roomId, peerId: peer!\.id, sourceKey \}\)/);
  assert.match(overlay, /new URLSearchParams\(\{ roomId, sourceKey \}\)/);
  assert.match(registerRoute, /validVoiceSource\(roomId, sourceKey\)/);
  assert.match(peersRoute, /validVoiceSource\(roomId, sourceKey\)/);
});

test('overlay answers room publishers and initiates calls with its live silent sender stream', () => {
  assert.match(overlay, /active\.on\('call', call => \{ call\.answer\(silentStream!\)/);
  assert.match(overlay, /peer\.call\(remoteId, silentStream!\)/);
  assert.match(overlay, /call\.on\('stream', stream => \{ gotStream = true; clearTimeout\(callTimeout\); attachPeerStream\(stream\); \}\)/);
});
