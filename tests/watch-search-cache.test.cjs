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

test('multi-audio HLS keeps renditions and prefers an English track', () => {
  const localHls = read('src/lib/watch/xtream-hls.ts');
  const worker = read('worker/src/server.js');
  const player = read('src/app/watch/[sessionId]/watch-room-client.tsx');
  for (const source of [localHls, worker]) {
    assert.match(source, /ffprobe/);
    assert.match(source, /-var_stream_map/);
    assert.match(source, /default:yes/);
  }
  assert.match(player, /AUDIO_TRACKS_UPDATED/);
  assert.match(player, /Movie audio language/);
  assert.match(player, /\benglish\b/i);
});

test('owner cache controls expose prepare and bounded LRU pruning', () => {
  const route = read('src/app/api/watch/service/route.ts');
  const worker = read('worker/src/server.js');
  assert.match(route, /getSession\(\)/);
  assert.match(route, /canManageRoom/);
  assert.match(worker, /app\.get\('\/watch\/cache\/status'/);
  assert.match(worker, /app\.post\('\/watch\/cache\/control'/);
  assert.match(worker, /pruneWatchHlsRoot/);
  assert.match(worker, /watchHlsJobs\.has\(entry\.name\)/);
});

test('Discord Activity keeps the YouTube resolver credential server-side', () => {
  const activity = read('src/app/activity-lite.js/route.ts');
  const resolver = read('src/app/api/watch/youtube/player/route.ts');
  assert.doesNotMatch(activity, /AIza[\w-]+/);
  assert.match(activity, /fetch\('\/api\/watch\/youtube\/player'/);
  assert.match(resolver, /process\.env\.YOUTUBE_INNERTUBE_API_KEY/);
  assert.match(resolver, /isValidVideoId\(videoId\)/);
});
