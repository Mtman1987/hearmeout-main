import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const route = readFileSync(join(process.cwd(), 'src/app/api/watch/xtream/direct-test/[streamId]/route.ts'), 'utf8');

test('Xtream direct-stream probe can choose a real VOD item automatically', () => {
  assert.match(route, /getXtreamCatalog\(\)/);
  assert.match(route, /requestedId\.toLowerCase\(\) === 'auto'/);
  assert.match(route, /xtream-vod-\\d\+/);
  assert.match(route, /selectedTitle/);
});

test('Xtream direct-stream probe checks byte-range playback without returning credentials', () => {
  assert.match(route, /getXtreamStreamUrl\('vod', id\)/);
  assert.match(route, /Range:\s*'bytes=0-63'/);
  assert.match(route, /reader\.cancel\(\)/);
  assert.match(route, /rangeHonored/);
  assert.match(route, /contentType/);
  assert.match(route, /directPlaybackSignal/);
  assert.match(route, /Provider URL and credentials are deliberately not returned/);
  assert.doesNotMatch(route, /source\.toString\(\)|source\.href/);
});

test('Xtream direct-stream probe bounds the request and does not transcode', () => {
  assert.match(route, /setTimeout\(\(\) => controller\.abort\(\), 8_000\)/);
  assert.match(route, /first response chunk and cancels the stream/);
  assert.doesNotMatch(route, /ensureXtreamHls|ffmpeg|transcod/);
});
