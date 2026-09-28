const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSpotlightPlaylist } = require('../worker/src/spotlight-hls');

const playlist = durations => '#EXTM3U\n' + durations.map((duration, index) =>
  '#EXTINF:' + duration + ',\nseg_' + String(index).padStart(6, '0') + '.ts\n').join('');

test('Spotlight treats a fresh progressing HLS playlist as playable', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 4]), 3000),
    { segmentCount: 3, stalled: false });
});

test('Spotlight rejects Twitch timestamp jumps even with eight segments', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 5213.499]), 1000),
    { segmentCount: 3, stalled: true });
});

test('Spotlight rejects segments that stopped arriving', () => {
  assert.deepEqual(inspectSpotlightPlaylist(playlist([4, 4, 4]), 21000),
    { segmentCount: 3, stalled: true });
});
