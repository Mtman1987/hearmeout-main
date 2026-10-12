const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');

function fixture() {
  const state = { uid: 'guest', grant: '', banned: false, room: { ownerId: 'owner', isPrivate: true, password: 'room-pass', expiresAt: new Date(Date.now() + 60000).toISOString() } };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/room-voice-access.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, Date,
    require(name) {
      if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: state.grant }) }) };
      if (name === './auth') return { getSession: async () => state.uid ? { uid: state.uid, user: {} } : null };
      if (name === './config') return { config: { jwtSecret: 'test-room-grant-secret' } };
      if (name === './db') return { ensureDb: async () => {}, db: { get: collection => collection === 'rooms' ? state.room : state.banned } };
      if (name === './room-lifecycle') return { effectiveRoomExpiry: expiry => expiry ? Date.parse(expiry) : null };
      return require(name);
    },
  });
  return { state, ...module.exports };
}

test('a guest cannot join a protected room without a server password grant', async () => {
  const f = fixture();
  await assert.rejects(f.requireRoomVoiceAccess('room'), /password/);
  f.state.grant = f.roomAccessValue('room', 'guest', 'room-pass');
  assert.equal((await f.requireRoomVoiceAccess('room')).uid, 'guest');
});
test('a room grant cannot be reused in another room or by another person', async () => {
  const f = fixture(); f.state.grant = f.roomAccessValue('room', 'guest', 'room-pass');
  await assert.rejects(f.requireRoomVoiceAccess('other'), /password/);
  f.state.uid = 'other-person';
  await assert.rejects(f.requireRoomVoiceAccess('room'), /password/);
});
test('changing a password revokes previously issued room access', async () => {
  const f = fixture(); f.state.grant = f.roomAccessValue('room', 'guest', 'room-pass');
  f.state.room.password = 'new-password';
  await assert.rejects(f.requireRoomVoiceAccess('room'), /password/);
});
test('owner access works but an expired room, ban, or missing session still blocks voice', async () => {
  const f = fixture(); f.state.uid = 'owner';
  assert.equal((await f.requireRoomVoiceAccess('room')).uid, 'owner');
  f.state.banned = true;
  await assert.rejects(f.requireRoomVoiceAccess('room'), /banned/);
  f.state.banned = false; f.state.room.expiresAt = new Date(0).toISOString();
  await assert.rejects(f.requireRoomVoiceAccess('room'), /expired/);
  f.state.uid = '';
  await assert.rejects(f.requireRoomVoiceAccess('room'), /Sign in/);
});
