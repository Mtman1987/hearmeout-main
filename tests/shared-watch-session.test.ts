import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRoomWatchSessionId, getDiscordWatchSessionId, getOverlayWatchSessionId } from '../src/lib/watch-session';

test('all entry points share two queues; duplicate completion advances once and controls never mutate them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-shared-state-'));
  process.env.WATCH_STATE_FILE = join(root, 'watch.json'); process.env.DB_FILE = join(root, 'db.sqlite');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({}); // No provider, Discord, or live worker calls.
  const service = await import('../src/lib/watch/watch-request-service');
  const { POST: complete } = await import('../src/app/api/watch/source-ended/route');
  const { POST: control } = await import('../src/app/api/watch/sessions/[sessionId]/control/route');
  try {
    const music = service.getWatchSession('music'); const movie = service.getWatchSession('movie');
    for (const room of ['room-a', 'room-b', 'room-c', 'discord-activity']) {
      assert.equal(service.getWatchSession(getRoomWatchSessionId(room, 'music')), music);
      assert.equal(service.getWatchSession(getOverlayWatchSessionId(room, 'movie')), movie);
    }
    assert.equal(service.getWatchSession(getDiscordWatchSessionId('guild', 'channel', 'music')), music);
    assert.equal(service.getWatchSession('watch-room-old-music'), music);
    const request = (id: string): any => ({ requestId: id, addedAt: new Date().toISOString(), requestedBy: { userId: 'test', username: 'Test' }, item: { id, type: 'music', title: id, playbackUrl: 'https://private-provider.invalid/credential/song', metadata: {} } });
    music.current = request('one'); music.queue = [request('two'), request('three')]; music.autoRadio = false;
    music.playback = { status: 'playing', updatedAt: Date.now(), position: 0, muted: true, volume: 0 };
    const publicState = service.getPublicWatchSession(music);
    assert.equal(Reflect.get(publicState.playback, 'volume'), undefined); assert.equal(Reflect.get(publicState.playback, 'muted'), undefined);
    assert.match(publicState.current!.item.playbackUrl, /^\/api\/watch\/stream\/music\/index.m3u8\?requestId=one$/);
    assert.equal((await complete(new Request('https://hmo.test/api/watch/source-ended', { method: 'POST', body: JSON.stringify({ kind: 'music', requestId: 'one' }) }))).status, 403);
    assert.equal((await control(new Request('https://hmo.test/control', { method: 'POST' }), { params: Promise.resolve({ sessionId: music.id }) })).status, 410);
    for (const action of ['mute', 'pause', 'play', 'volume', 'next', 'seek', 'clear']) await assert.rejects(service.controlWatchSession(music.id, action), /temporarily unavailable/);
    assert.equal(music.current?.requestId, 'one');
    await Promise.all(Array.from({ length: 20 }, () => service.advanceSharedSource('music', 'one')));
    assert.equal(music.current?.requestId, 'two'); assert.deepEqual(music.queue.map(r => r.requestId), ['three']);
    await service.advanceSharedSource('music', 'one'); assert.equal(music.current?.requestId, 'two');
    assert.equal(movie.current, null);
    const disk = JSON.parse(readFileSync(process.env.WATCH_STATE_FILE, 'utf8'));
    assert.ok(disk.sessions.every(([id]: [string]) => ['discord-music-room', 'discord-watch-room'].includes(id)));
  } finally { globalThis.fetch = originalFetch; process.once('exit', () => rmSync(root, { recursive: true, force: true })); }
});
