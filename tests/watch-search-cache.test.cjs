'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('provider search ranks exact years and never silently replaces a selected item', () => {
  const provider = read('src/lib/watch/xtream-provider.ts');
  const service = read('src/lib/watch/watch-request-service.ts');
  const searchRoute = read('src/app/api/watch/search/route.ts');
  assert.match(provider, /if \(itemYear === requestedYear\) score \+= 85/);
  assert.match(provider, /else score -= 60/);
  assert.match(provider, /metadata\?\.quality === 'CAM'\) score -= 45/);
  assert.match(service, /findXtreamCatalogItemById\(params\.itemId\)/);
  assert.match(service, /selectedProviderItem \|\| explicitEpisode/);
  assert.match(searchRoute, /selectionRequired/);
});

test('the shared producer selects English once, otherwise the default or first audio track', () => {
  const { selectSharedAudioStream } = require('../worker/src/shared-source-audio');
  const streams = [
    { index: 0, codec_type: 'video' },
    { index: 1, codec_type: 'audio', tags: { language: 'fra' }, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', tags: { language: 'eng' } },
  ];
  assert.equal(selectSharedAudioStream(streams), 2);
  assert.equal(selectSharedAudioStream(streams.slice(0, 2)), 1);
  assert.equal(selectSharedAudioStream([]), null);
});

// Per-item prepare/prune and client-side language controls were deliberately
// retired. Real producer pacing, bounds, concurrency and retry behavior live
// in shared-media-relay.test.cjs; listener-only controls in listener-volume.
test('Discord player never resolves provider credentials or opens a direct provider fallback', () => {
  const player = read('src/lib/shared-player-script.ts');
  const resolver = read('src/app/api/watch/source/route.ts');
  assert.doesNotMatch(player, /AIza[\w-]+|YOUTUBE_INNERTUBE_API_KEY|\/api\/watch\/youtube\/player|youtube\.com\/embed/);
  assert.match(resolver, /isDjWorkerRequest/);
});
