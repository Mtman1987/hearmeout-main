const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('HearMeOut exposes a room-scoped Say queue poll that checks bot roster membership', () => {
  const route = source('src/app/api/rooms/persona-speech/route.ts');
  assert.match(route, /db\.get\(\`rooms\/\$\{roomId\}\/users\`, presenceId\)/);
  assert.match(route, /requireRoomVoiceAccess\(roomId\)/);
  assert.match(route, /Room password is required/);
  assert.match(route, /presence\.bot !== true/);
  assert.match(route, /hmo-say-/);
  assert.match(route, /api\/say\/next/);
  assert.match(route, /latest/);
  assert.match(route, /Cache-Control': 'no-store'/);
});

test('room UI activates and plays the room-scoped bot speech queue', () => {
  const player = source('src/app/rooms/[roomId]/_components/RoomSayPlayerAudio.tsx');
  const userList = source('src/app/rooms/[roomId]/_components/UserList.tsx');
  const roomPage = source('src/app/rooms/[roomId]/page.tsx');
  const userCard = source('src/app/rooms/[roomId]/_components/UserCard.tsx');
  const middleware = source('src/middleware.ts');
  assert.match(userList, /RoomSayPlayerAudio roomId=\{roomId\} personaIds=\{speechPersonaIds\} volumes=\{volumesByPersona\}/);
  assert.match(player, /api\/rooms\/persona-speech/);
  assert.match(player, /new Audio\(next\.audioUrl\)/);
  assert.match(player, /audio\.play\(\)/);
  assert.match(player, /useState\(true\)/);
  assert.match(player, /hmo-resume-bot-audio/);
  assert.match(player, /sr-only.*aria-live="polite"/);
  assert.doesNotMatch(player, /Enable bot audio|Resume bot audio|Bot reply volume/);
  assert.match(player, /MAX_PENDING_SAY_ITEMS/);
  assert.match(player, /seenRef\.current\.delete/);
  assert.match(player, /SAY_POLL_INTERVAL_MS/);
  assert.match(roomPage, /<RoomAudioPlayback volume=\{localVolume\} \/>/);
  assert.match(roomPage, /<RoomAudioRenderer \/>/);
  // RoomAudioPlayback is the only LiveKit track renderer; a second AudioTrack
  // component duplicated incoming audio and bypassed the room volume.
  assert.doesNotMatch(userList, /useTracks|AudioTrack|livekit-client/);
  assert.match(userCard, /parseParticipantMetadata\(participant\.metadata\)/);
  assert.doesNotMatch(userCard, /participant\.metadata \? JSON\.parse/);
  assert.match(middleware, /api\/rooms\/persona-speech/);
});
