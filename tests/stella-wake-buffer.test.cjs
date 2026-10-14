'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Stella wake test is opt-in, bounded, and only hands off after the wake phrase', () => {
  const listener = source('src/app/rooms/[roomId]/_components/StellaWakeTestListener.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(userList, /<StellaWakeTestListener roomId=\{roomId\} remoteParticipants=\{voiceInputParticipants\}/);
  assert.match(listener, /Enable Stella wake test/);
  assert.match(listener, /const BUFFER_MS = 30_000/);
  assert.match(listener, /const MAX_SEGMENTS = 12/);
  assert.match(listener, /if \(!final \|\| !\/\\bstella\\b\/i\.test\(text\)/);
  assert.match(listener, /sendRoomPersonaCommand/);
  assert.match(listener, /pre-wake transcript text is not sent by HearMeOut/);
  assert.match(listener, /Browser speech recognition may send microphone audio/);
});

test('Stella wake test reuses the active-room bot resolver and canonical command route', () => {
  const listener = source('src/app/rooms/[roomId]/_components/StellaWakeTestListener.tsx');
  const client = source('src/lib/room-persona-client.ts');
  assert.match(listener, /resolveBotInvocation\(latestRequest, targetsRef\.current\)/);
  assert.match(listener, /targetsRef\.current\[0\]/);
  assert.match(listener, /sendRoomPersonaCommand/);
  assert.match(client, /\/api\/bot\/commands/);
});
