import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('StreamWeaver bot actions select the canonical music and movie request services', () => {
  const route = fs.readFileSync('src/app/api/internal/bot/actions/route.ts', 'utf8');
  assert.match(route, /sessionId === getGlobalWatchSessionId\(\)/);
  assert.match(route, /await requestWatchItem\(requestIdentity\)/);
  assert.match(route, /await requestWatchMusicItem\(\{ \.\.\.requestIdentity, platform: 'admin' \}\)/);
  assert.match(route, /mediaKind = sessionId === getGlobalWatchSessionId\(\) \? 'movie' : 'music'/);
});
