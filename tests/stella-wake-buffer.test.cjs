'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('room wake handling uses the active local Companion listener, not a failed browser test widget', () => {
  const listener = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(userList, /<WakeWordListener roomId=\{roomId\} remoteParticipants=\{voiceInputParticipants\}/);
  assert.doesNotMatch(userList, /StellaWakeTestListener/);
  assert.match(listener, /LOCAL_COMPANION_WAKE_EVENT/);
  assert.match(listener, /resolveBotInvocation\(transcript, targets\)/);
  assert.match(listener, /sendRoomPersonaCommand/);
  assert.match(listener, /if \(!transcript\) return/);
  assert.doesNotMatch(listener, /new MediaRecorder|SpeechRecognition/);
});

test('room wake handling shares the active-room bot resolver and canonical command route', () => {
  const listener = source('src/app/rooms/[roomId]/_components/WakeWordListener.tsx');
  const client = source('src/lib/room-persona-client.ts');

  assert.match(listener, /resolveBotInvocation\(transcript, targets\)/);
  assert.match(listener, /wakeNames/);
  assert.match(listener, /sendRoomPersonaCommand/);
  assert.match(client, /\/api\/bot\/commands/);
});

test('TTS-only personas do not start RTC worker sessions and remain available to wake routing', () => {
  const session = source('src/app/api/bots/session/route.ts');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');
  assert.match(session, /speechMode:\s*'say-player'/);
  assert.match(session, /joinMode:\s*'say-player-only'/);
  assert.match(session, /if \(action === 'join'\) \{/);
  assert.match(userList, /RoomSayPlayerAudio/);
  assert.match(userList, /Say Player connected/);
});
