import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/overlay/[roomId]/page.tsx'), 'utf8');
const twitch = fs.readFileSync(path.join(process.cwd(), 'src/app/api/twitch-bot/route.ts'), 'utf8');
const botActions = fs.readFileSync(path.join(process.cwd(), 'src/app/api/internal/bot/actions/route.ts'), 'utf8');

test('legacy overlay does not clone or synchronize another Lounge player', () => {
  assert.doesNotMatch(source, /APOLLO_LOUNGE_PROXY|system-spacemountainlive-lounge|setLoungeState|advancingEndedRequestRef/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/api/system/spacemountainlive-lounge/apollo/[...path]/route.ts')), false);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'movie'\)/);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'music'\)/);
  assert.doesNotMatch(source, /getGlobalWatchSessionId/);
  assert.doesNotMatch(source, /getMusicWatchSessionId/);
  assert.doesNotMatch(source, /spacemountainlive-lounge\/ensure/);
});

test('auto lane follows the most recently controlled playing queue', () => {
  assert.match(source, /state\.playback\?\.status === 'playing'/);
  assert.match(source, /newerPlaybackFirst/);
  assert.match(source, /bundles\.filter\(\(bundle\) => sessionHasActiveMedia\(bundle\.state\)\)\.sort\(newerPlaybackFirst\)/);
});

test('YouTube music uses the browser embed before the proxy fallback', () => {
  assert.match(source, /metadata\.embedPlaybackUrl \|\| metadata\.videoPlaybackUrl/);
  assert.match(source, /if \(mode === 'video' && options\.video\) return options\.video/);
  assert.match(source, /searchParams\.set\('autoplay', '1'\)/);
});

test('SpaceMountain actions share one permanent Live HMO lounge queue', () => {
  assert.match(botActions, /SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(botActions, /getWatchSession\(SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(botActions, /sessionId: SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(botActions, /controlSessionId = isSpaceMountainLoungeSession\(tenantId, sessionId\) \? SPACEMOUNTAIN_LOUNGE_SESSION_ID : sessionId/);
  assert.doesNotMatch(botActions, /Apollo|requestApolloLounge|readApolloLoungeState|api\/watch\/broadcast\/lounge-twitch-request/);
});

test('SpaceMountain Twitch media commands stay inside Live HMO', () => {
  assert.match(twitch, /SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL/);
  assert.match(twitch, /SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(twitch, /requestWatchMusicItem/);
  assert.match(twitch, /requestWatchItem/);
  assert.match(twitch, /controlWatchSession/);
  assert.match(twitch, /auto-radio/);
  assert.doesNotMatch(twitch, /APOLLO_LOUNGE|web-terminal-bvesa|relayApolloLoungeCommand|lounge-twitch-request/);
});

test('play skips an expired current item or restarts it when the queue is empty', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/watch/watch-request-service.ts'), 'utf8');
  assert.match(service, /const duration = runtimeSeconds\(session\.current\.item\.runtime\)/);
  assert.match(service, /if \(session\.queue\.length > 0\) action = 'next'/);
  assert.match(service, /else position = 0/);
});
