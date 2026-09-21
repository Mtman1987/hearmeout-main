import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/overlay/[roomId]/page.tsx'), 'utf8');
const apolloProxy = fs.readFileSync(path.join(process.cwd(), 'src/app/api/system/spacemountainlive-lounge/apollo/[...path]/route.ts'), 'utf8');
const commands = fs.readFileSync(path.join(process.cwd(), 'src/lib/music-command-service.ts'), 'utf8');
const twitch = fs.readFileSync(path.join(process.cwd(), 'src/app/api/twitch-bot/route.ts'), 'utf8');
const botActions = fs.readFileSync(path.join(process.cwd(), 'src/app/api/internal/bot/actions/route.ts'), 'utf8');

test('SpaceMountain Lounge consumes Apollo while ordinary overlays retain HearMeOut sessions', () => {
  assert.match(source, /roomId === 'system-spacemountainlive-lounge'/);
  assert.match(source, /APOLLO_LOUNGE_PROXY.*spacemountainlive-lounge\/apollo/);
  assert.match(source, /api\(`\$\{APOLLO_LOUNGE_PROXY\}\/api\/watch\/broadcast\/state`\)/);
  assert.match(source, /activeState\?\.broadcast\?\.ready[\s\S]*apolloLoungeUrl[\s\S]*apolloFallbackPlaybackUrl/);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'movie'\)/);
  assert.match(source, /getRoomWatchSessionId\(roomId, 'music'\)/);
  assert.doesNotMatch(source, /getGlobalWatchSessionId/);
  assert.doesNotMatch(source, /getMusicWatchSessionId/);
  assert.doesNotMatch(source, /spacemountainlive-lounge\/ensure/);
});

test('Apollo Lounge proxy is read-only and limited to canonical state and HLS', () => {
  assert.match(apolloProxy, /APOLLO_LOUNGE_ORIGIN/);
  assert.match(apolloProxy, /api\/watch\/broadcast\/state/);
  assert.match(apolloProxy, /api\/watch\/sessions\/\$\{ROOM_ID\}\/broadcast/);
  assert.match(apolloProxy, /Unsupported Apollo Lounge path/);
  assert.doesNotMatch(apolloProxy, /export async function POST/);
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

test('Apollo Lounge remains visible while its HLS worker is starting', () => {
  assert.match(source, /function apolloFallbackPlaybackUrl/);
  assert.match(source, /youtube-nocookie\.com\/embed/);
  assert.match(source, /metadata\.videoId/);
});

test('legacy StreamWeaver Lounge actions are adapted to Apollo state and requests', () => {
  assert.match(botActions, /isSpaceMountainLoungeSession/);
  assert.match(botActions, /api\/watch\/broadcast\/state/);
  assert.match(botActions, /api\/watch\/broadcast\/lounge-twitch-request/);
  assert.match(botActions, /send\('spacemountainlive'\)/);
  assert.match(botActions, /response\.status === 403[\s\S]*send\('mtman1987'\)/);
});

test('Twitch moderators can control Lounge media from chat', () => {
  for (const command of ['!play', '!pause', '!mute', '!unmute', '!volume']) assert.match(commands, new RegExp(command.replace('!', '\\!')));
  assert.match(commands, /controlWatchSession\(sessionId, parsed\.action/);
  assert.match(twitch, /message === '!play'/);
  assert.match(twitch, /isAdmin: Boolean\(context\.mod\)/);
});

test('SpaceMountain Lounge leaves automatic advancement to Apollo', () => {
  assert.match(source, /const advanceEndedMedia = useCallback/);
  assert.match(source, /Apollo owns the durable clock and advances even with no viewers/);
  assert.doesNotMatch(source, /quick-control/);
  assert.match(source, /code === 0[\s\S]*void advanceEndedMedia\(\)/);
  assert.match(source, /onEnded=\{\(\) => void advanceEndedMedia\(\)\}/);
});

test('an ended Apollo song stays stopped until Apollo reports its replacement', () => {
  assert.match(source, /advancingEndedRequestRef\.current === nextState\.current\.requestId/);
  assert.match(source, /youtubeCommand\('pauseVideo'\)/);
  assert.match(source, /setLoungeState\(state\)/);
  assert.match(source, /advancingEndedRequestRef\.current !== activeRequestId[\s\S]*advancingEndedRequestRef\.current = null/);
});

test('play skips an expired current item or restarts it when the queue is empty', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/watch/watch-request-service.ts'), 'utf8');
  assert.match(service, /const duration = runtimeSeconds\(session\.current\.item\.runtime\)/);
  assert.match(service, /if \(session\.queue\.length > 0\) action = 'next'/);
  assert.match(service, /else position = 0/);
});
