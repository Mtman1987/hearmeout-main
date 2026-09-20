import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/overlay/[roomId]/page.tsx'), 'utf8');
const commands = fs.readFileSync(path.join(process.cwd(), 'src/lib/music-command-service.ts'), 'utf8');
const twitch = fs.readFileSync(path.join(process.cwd(), 'src/app/api/twitch-bot/route.ts'), 'utf8');

test('SpaceMountain Lounge consumes the same global queues as !sr and !wr', () => {
  assert.match(source, /roomId === 'system-spacemountainlive-lounge'/);
  assert.match(source, /systemLounge \? getGlobalWatchSessionId\(\)/);
  assert.match(source, /systemLounge \? getMusicWatchSessionId\(\)/);
});

test('auto lane follows the most recently controlled playing queue', () => {
  assert.match(source, /state\.playback\?\.status === 'playing'/);
  assert.match(source, /newerPlaybackFirst/);
  assert.match(source, /bundles\.filter\(\(bundle\) => sessionHasActiveMedia\(bundle\.state\)\)\.sort\(newerPlaybackFirst\)/);
});

test('YouTube music uses the browser embed before the proxy fallback', () => {
  assert.match(source, /metadata\.embedPlaybackUrl \|\| metadata\.videoPlaybackUrl/);
  assert.match(source, /searchParams\.set\('autoplay', '1'\)/);
});

test('Twitch moderators can control Lounge media from chat', () => {
  for (const command of ['!play', '!pause', '!mute', '!unmute', '!volume']) assert.match(commands, new RegExp(command.replace('!', '\\!')));
  assert.match(commands, /controlWatchSession\(sessionId, parsed\.action/);
  assert.match(twitch, /message === '!play'/);
  assert.match(twitch, /isAdmin: Boolean\(context\.mod\)/);
});

test('SpaceMountain Lounge advances the global queue when embedded or native media ends', () => {
  assert.match(source, /const advanceEndedMedia = useCallback/);
  assert.match(source, /action: 'next'/);
  assert.match(source, /expectedRequestId: requestId/);
  assert.match(source, /code === 0[\s\S]*void advanceEndedMedia\(\)/);
  assert.match(source, /onEnded=\{\(\) => void advanceEndedMedia\(\)\}/);
});

test('play skips an expired current item or restarts it when the queue is empty', () => {
  const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/watch/watch-request-service.ts'), 'utf8');
  assert.match(service, /const duration = runtimeSeconds\(session\.current\.item\.runtime\)/);
  assert.match(service, /if \(session\.queue\.length > 0\) action = 'next'/);
  assert.match(service, /else position = 0/);
});
