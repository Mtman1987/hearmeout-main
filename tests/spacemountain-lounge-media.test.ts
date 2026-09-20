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
