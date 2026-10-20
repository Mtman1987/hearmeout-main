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


test('stream overlay consumes source-key protected bot Say audio without replacing microphone audio', () => {
  const route = source('src/app/api/voice/stream-speech/route.ts');
  const overlay = source('src/app/overlay/voices/[roomId]/page.tsx');
  assert.match(route, /validVoiceSource\(roomId, sourceKey\)/);
  assert.ok(route.includes('streamVoiceEnabled'));
  assert.match(route, /rooms\/\$\{roomId\}\/users/);
  assert.match(route, /api\/say\/next/);
  assert.match(overlay, /api\/voice\/stream-speech/);
  assert.ok(overlay.includes('playNextSay'));
  assert.ok(overlay.includes('sayPoll = setInterval'));
  assert.match(overlay, /sayAudios\.forEach/);
});

test('room header separates the visual overlay URL from the bot-and-microphone voice source', () => {
  const roomPage = source('src/app/rooms/[roomId]/page.tsx');
  const sourceRoute = source('src/app/api/voice/stream-source/route.ts');
  assert.match(roomPage, /copyVoiceSourceUrl/);
  assert.match(roomPage, /action: 'source'/);
  assert.match(roomPage, /includes room and bot voices/);
  assert.match(sourceRoute, /'source'/);
  assert.match(sourceRoute, /voiceSourceUrl\(roomId, config\.baseUrl\)/);
});

 
test('HearMeOut bot replies stay on the hidden room Say Player stream', () => {
  const route = source('src/app/api/bot/commands/route.ts');
  assert.match(route, /hidden room Say Player only/);
  assert.match(route, /attempt < 3 && queuedResult\.skipped/);
  assert.match(route, /queueSpeech\(sayStreamKey\)/);
  assert.doesNotMatch(route, /deliveryTenantId = personaId;\s*queuedResult = await queueSpeech\(deliveryTenantId\)/);
});
