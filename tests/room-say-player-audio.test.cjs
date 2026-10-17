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
  const middleware = source('src/middleware.ts');
  assert.match(userList, /RoomSayPlayerAudio/);
  assert.match(player, /api\/rooms\/persona-speech/);
  assert.match(player, /new Audio\(next\.audioUrl\)/);
  assert.match(player, /audio\.play\(\)/);
  assert.match(player, /Enable bot audio/);
  assert.match(player, /Resume bot audio/);
  assert.match(middleware, /api\/rooms\/persona-speech/);
});
