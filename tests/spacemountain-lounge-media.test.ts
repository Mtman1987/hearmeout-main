import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/overlay/[roomId]/page.tsx'), 'utf8');
const twitch = fs.readFileSync(path.join(process.cwd(), 'src/app/api/twitch-bot/route.ts'), 'utf8');
const botActions = fs.readFileSync(path.join(process.cwd(), 'src/app/api/internal/bot/actions/route.ts'), 'utf8');
const lounge = fs.readFileSync(path.join(process.cwd(), 'src/lib/spacemountain-lounge.ts'), 'utf8');
const activityAccess = fs.readFileSync(path.join(process.cwd(), 'src/lib/activity-access.ts'), 'utf8');
const watchService = fs.readFileSync(path.join(process.cwd(), 'src/lib/watch/watch-request-service.ts'), 'utf8');

test('Lounge overlay reads separate permanent music and movie sessions', () => {
  assert.doesNotMatch(source, /APOLLO_LOUNGE_PROXY|setLoungeState|advancingEndedRequestRef/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/api/system/spacemountainlive-lounge/apollo/[...path]/route.ts')), false);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'movie'\)/);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'music'\)/);
  assert.match(source, /Promise\.all\(\[/);
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

test('SpaceMountain actions preserve separate music and movie queues', () => {
  assert.match(lounge, /SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(lounge, /SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(botActions, /getSpaceMountainLoungeLane/);
  assert.match(botActions, /SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(botActions, /SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(botActions, /sessionId: getSpaceMountainLoungeSessionId\(sessionId, requestedLane\)/);
  assert.doesNotMatch(botActions, /Apollo|requestApolloLounge|readApolloLoungeState|api\/watch\/broadcast\/lounge-twitch-request/);
});

test('SpaceMountain Lounge media is auth-free during development', () => {
  assert.match(activityAccess, /SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(activityAccess, /SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(activityAccess, /rooms\/\$\{SPACEMOUNTAIN_LOUNGE_ROOM_ID\}\/users/);
  assert.match(watchService, /session\.id === SPACEMOUNTAIN_LOUNGE_SESSION_ID \|\| session\.id === SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(botActions, /!isPublicQueueRequest && !isSpaceMountainLoungeControl && !isBotActionServiceRequest\(request\)/);
});

test('SpaceMountain Twitch media commands stay inside Live HMO', () => {
  assert.match(twitch, /SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL/);
  assert.match(twitch, /requestWatchMusicItem/);
  assert.match(twitch, /requestWatchItem/);
  assert.match(twitch, /controlWatchSession/);
  assert.doesNotMatch(twitch, /APOLLO_LOUNGE|web-terminal-bvesa|relayApolloLoungeCommand|lounge-twitch-request/);
});

test('play skips an expired current item or restarts it when the queue is empty', () => {
  assert.match(watchService, /const duration = runtimeSeconds\(session\.current\.item\.runtime\)/);
  assert.match(watchService, /if \(session\.queue\.length > 0\) action = 'next'/);
  assert.match(watchService, /else position = 0/);
});
