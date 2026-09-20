import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/overlay/[roomId]/page.tsx'), 'utf8');

test('SpaceMountain Lounge consumes the same global queues as !sr and !wr', () => {
  assert.match(source, /roomId === 'system-spacemountainlive-lounge'/);
  assert.match(source, /systemLounge \? getGlobalWatchSessionId\(\)/);
  assert.match(source, /systemLounge \? getMusicWatchSessionId\(\)/);
});

test('YouTube music uses the browser embed before the proxy fallback', () => {
  assert.match(source, /metadata\.embedPlaybackUrl \|\| metadata\.videoPlaybackUrl/);
});
