import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { twitchMusicSessionId } from '../src/lib/twitch-media-scope';
import { twitchSourceUrl, validTwitchSource } from '../src/lib/twitch-source-access';
import { isPublicActivityRequest } from '../src/lib/activity-access';
process.env.HEARMEOUT_SERVICE_SECRET = 'isolated-test-service-key';
process.env.WATCH_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'twitch-media-test-')), 'state.json');

test('two broadcaster sources target separate queues and cannot use each other’s source capability', () => {
  const a = new URL(twitchSourceUrl('123', 'https://hmo.test'));
  const b = new URL(twitchSourceUrl('456', 'https://hmo.test'));
  assert.notEqual(twitchMusicSessionId('123'), twitchMusicSessionId('456'));
  assert.equal(a.pathname, '/overlay/twitch-123');
  assert.equal(a.searchParams.get('media'), 'music');
  assert(validTwitchSource('123', a.searchParams.get('sourceKey')!));
  assert(!validTwitchSource('456', a.searchParams.get('sourceKey')!));
  assert(!validTwitchSource('123', b.searchParams.get('sourceKey')!));
  assert(!validTwitchSource('../123', 'bad'));
  assert.throws(() => twitchMusicSessionId(''));
});
test('OBS session is readable without login; mutations are not public Activity exceptions', () => {
  assert(isPublicActivityRequest(new URL('https://hmo.test/api/watch/sessions/watch-twitch-123-music/state'), 'GET'));
  for (const action of ['control', 'quick-control', 'request', 'accept']) {
    assert(!isPublicActivityRequest(new URL('https://hmo.test/api/watch/sessions/watch-twitch-123-music/' + action), 'POST'));
  }
});
test('source end advances only its queue and duplicate/stale end events do not skip a second song', async () => {
  const { getWatchSession } = await import('../src/lib/watch-request-service');
  const { POST } = await import('../src/app/api/twitch-source/[tenantId]/ended/route');
  const a = getWatchSession(twitchMusicSessionId('123'));
  const b = getWatchSession(twitchMusicSessionId('456'));
  const item = { id: 'test', title: 'Test', type: 'music', metadata: {}, playbackUrl: '/test.mp4' };
  a.current = { requestId: 'first-a', item, requestedBy: { userId: 'a', username: 'A' } } as any;
  a.queue = [{ requestId: 'next-a', item, requestedBy: { userId: 'a', username: 'A' } } as any];
  b.current = { requestId: 'first-b', item, requestedBy: { userId: 'b', username: 'B' } } as any;
  const key = new URL(twitchSourceUrl('123', 'https://hmo.test')).searchParams.get('sourceKey')!;
  const request = () => new Request('https://hmo.test/api/twitch-source/123/ended', { method: 'POST', headers: { 'content-type': 'application/json', 'x-source-key': key }, body: JSON.stringify({ expectedRequestId: 'first-a', action: 'clear' }) });
  const wrong = await POST(request(), { params: Promise.resolve({ tenantId: '456' }) });
  assert.equal(wrong.status, 401);
  assert.equal((await POST(request(), { params: Promise.resolve({ tenantId: '123' }) })).status, 200);
  assert.equal(a.current?.requestId, 'next-a');
  assert.equal(b.current?.requestId, 'first-b');
  await POST(request(), { params: Promise.resolve({ tenantId: '123' }) });
  assert.equal(a.current?.requestId, 'next-a');
});
test('existing worker authority accepts only tenant music and source actions with matching identity', async () => {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/internal/bot/actions/route');
  process.env.HMO_WORKER_SHARED_SECRET = 'isolated-test-worker-key';
  const request = (changes: any) => new NextRequest('https://hmo.test/api/internal/bot/actions', {
    method: 'POST', headers: { authorization: 'Bearer isolated-test-worker-key', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'hmo.media.source', streamMode: 'twitch', tenantId: '123', sessionId: twitchMusicSessionId('123'), lane: 'music', ...changes }),
  });
  assert.equal((await POST(request({}))).status, 200);
  assert.equal((await POST(request({ sessionId: twitchMusicSessionId('456') }))).status, 403);
  assert.equal((await POST(request({ lane: 'movie' }))).status, 403);
  assert.equal((await POST(request({ action: 'hmo.bot.control' }))).status, 401);
  delete process.env.HMO_WORKER_SHARED_SECRET;
});
