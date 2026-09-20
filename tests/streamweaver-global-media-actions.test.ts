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

test('public chat requests can reach only the two global queues without service authentication', () => {
  const route = fs.readFileSync('src/app/api/internal/bot/actions/route.ts', 'utf8');
  assert.match(route, /const isPublicQueueRequest = !room/);
  assert.match(route, /action === 'hmo\.media\.request'/);
  assert.match(route, /getMusicWatchSessionId\(\)/);
  assert.match(route, /getGlobalWatchSessionId\(\)/);
  assert.match(route, /!isPublicQueueRequest && !isSpaceMountainLoungeControl && !isBotActionServiceRequest\(request\)/);
});

test('SpaceMountain broadcaster and moderator controls are limited to the global players', () => {
  const route = fs.readFileSync('src/app/api/internal/bot/actions/route.ts', 'utf8');
  assert.match(route, /const isSpaceMountainLoungeControl = !room/);
  assert.match(route, /action === 'hmo\.media\.control'/);
  assert.match(route, /isGlobalSession/);
  assert.match(route, /tenantId === 'spacemountainlive'/);
  assert.match(route, /actorRole === 'owner' \|\| actorRole === 'moderator'/);
});
