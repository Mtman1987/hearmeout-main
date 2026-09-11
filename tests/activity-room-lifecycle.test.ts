import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { normalizeActivityRoomLifecycle } from '../src/lib/activity-room-lifecycle';
import { effectiveRoomExpiry, ROOM_LIFETIME_MS } from '../src/lib/room-lifecycle';
import { ACTIVITY_ROOM_ID, getRoomWatchSessionId } from '../src/lib/watch-session';

test('legacy permanent rooms get one fixed six-hour lifetime, preserving room data', () => {
  const now = Date.parse('2026-09-11T00:00:00Z');
  const room = normalizeActivityRoomLifecycle({ systemRoom: true, playlist: [{ id: 'song' }], ownerId: 'owner' }, now);
  assert.equal(effectiveRoomExpiry(room.expiresAt, room.createdAt), now + ROOM_LIFETIME_MS);
  assert.equal(room.systemRoom, false);
  assert.deepEqual(room.playlist, [{ id: 'song' }]);
  assert.equal(room.ownerId, 'owner');
  assert.deepEqual(normalizeActivityRoomLifecycle(room, now + 60_000), room);
});

test('migration respects existing creation time and shorter expiry', () => {
  const createdAt = '2026-09-10T00:00:00Z';
  const expiresAt = '2026-09-10T01:00:00Z';
  const now = Date.parse('2026-09-11T00:00:00Z');
  const room = normalizeActivityRoomLifecycle({ createdAt, expiresAt, systemRoom: true }, now);
  assert.equal(room.createdAt, createdAt);
  assert.equal(Date.parse(room.expiresAt), Date.parse(expiresAt));
  assert.ok(effectiveRoomExpiry(room.expiresAt, room.createdAt)! < now);
});

test('room creation is explicit, reads do not resurrect deletion, and launches do not extend expiry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hmo-lifecycle-'));
  process.env.DB_FILE = join(dir, 'app.db');
  const { db, ensureDb, flushDb } = await import('../src/lib/db');
  const { ensureDiscordActivityRoom } = await import('../src/lib/activity-room');
  const { GET } = await import('../src/app/api/activity-room/ensure/route');
  try {
    await ensureDb();
    assert.equal(db.get('rooms', ACTIVITY_ROOM_ID), null);
    assert.equal((await (await GET()).json()).room, null);
    const room = await ensureDiscordActivityRoom();
    assert.equal(Date.parse(room.expiresAt) - Date.parse(room.createdAt), ROOM_LIFETIME_MS);
    assert.deepEqual(await ensureDiscordActivityRoom(), JSON.parse(JSON.stringify(room)));
    db.delete('rooms', ACTIVITY_ROOM_ID);
    assert.equal((await (await GET()).json()).room, null);
    assert.equal(db.get('rooms', ACTIVITY_ROOM_ID), null);
    db.set('rooms', ACTIVITY_ROOM_ID, { ...room, createdAt: '2020-01-01T00:00:00Z', expiresAt: '2020-01-01T06:00:00Z' });
    assert.equal((await (await GET()).json()).room.expiresAt, '2020-01-01T06:00:00Z');
    const relaunched = await ensureDiscordActivityRoom();
    assert.ok(Date.parse(relaunched.expiresAt) > Date.now());
    assert.equal(getRoomWatchSessionId(ACTIVITY_ROOM_ID, 'movie'), 'discord-watch-room');
    assert.equal(getRoomWatchSessionId(ACTIVITY_ROOM_ID, 'music'), 'discord-music-room');
  } finally {
    flushDb();
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
});
