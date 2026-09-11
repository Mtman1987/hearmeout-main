import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { GLOBAL_WATCH_SESSION_ID, normalizeWatchSessionAlias } from '../src/lib/watch-session';

const legacy = '1281781267383545936-1281781267383545940';
test('legacy Discord voice room IDs resolve to the shared movie without browser login', async () => {
  for (const id of [legacy, `watch-${legacy}`, GLOBAL_WATCH_SESSION_ID]) {
    assert.equal(normalizeWatchSessionAlias(id), GLOBAL_WATCH_SESSION_ID);
    for (const action of ['request', 'accept', 'control', 'state']) {
      const response = await middleware(new NextRequest(`https://hmo.test/api/watch/sessions/${id}/${action}`, {
        method: action === 'state' ? 'GET' : 'POST',
      }));
      assert.equal(response.headers.get('x-middleware-next'), '1', `${id}/${action}`);
    }
  }
});
test('private room names retain their existing identity and login requirement', async () => {
  for (const id of ['watch-room-private-movie', 'owner-secret-room', '123-456']) {
    assert.notEqual(normalizeWatchSessionAlias(id), GLOBAL_WATCH_SESSION_ID);
    const response = await middleware(new NextRequest(`https://hmo.test/api/watch/sessions/${id}/state`));
    assert.equal(response.status, 401);
  }
});
