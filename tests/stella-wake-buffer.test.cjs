'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('wake-word test is opt-in, bounded, and only hands off after an active bot wake phrase', () => {
  const listener = source('src/app/rooms/[roomId]/_components/StellaWakeTestListener.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');

  assert.match(userList, /<StellaWakeTestListener roomId=\{roomId\} remoteParticipants=\{voiceInputParticipants\}/);
  assert.match(listener, /Enable wake-word test/);
  assert.match(listener, /const BUFFER_MS = 30_000/);
  assert.match(listener, /const MAX_SEGMENTS = 12/);
  assert.match(listener, /wakePhraseIn\(spokenText, targetsRef\.current\)/);
  assert.match(listener, /useCollection<RoomBotPresence>/);
  assert.match(listener, /'Stella'/);
  assert.match(listener, /sendRoomPersonaCommand/);
  assert.match(listener, /pre-wake transcript text is not sent by HearMeOut/);
  assert.match(listener, /Browser speech recognition may send microphone audio/);
});

test('wake-word test reuses the active-room bot resolver and canonical command route', () => {
  const listener = source('src/app/rooms/[roomId]/_components/StellaWakeTestListener.tsx');
  const client = source('src/lib/room-persona-client.ts');
  // Resolve against the full transcript so a wake phrase can select the correct bot.
  assert.match(listener, /resolveBotInvocation\(spokenText, targetsRef\.current\)/);
  assert.match(listener, /targetsRef\.current\[0\]/);
  assert.match(listener, /Hey Athena/);
  assert.match(listener, /'Stella'/);
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
