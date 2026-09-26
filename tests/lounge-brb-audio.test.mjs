import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/lib/lounge-player-html.ts', import.meta.url), 'utf8');
const script = source.split('<script>\n')[1].split('\n</script>')[0];

function createViewer(initiallyMuted) {
  const listeners = {};
  const video = {
    muted: initiallyMuted,
    volume: .85,
    play: () => Promise.resolve(),
    load: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
  };
  const parent = {};
  const window = { parent, addEventListener: (type, callback) => { listeners[type] = callback; } };
  const document = { getElementById: () => video, addEventListener: () => {} };
  vm.runInNewContext(script, { window, document, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {} });
  video.muted = initiallyMuted;
  return { video, send(active, origin = 'https://spmt.live') {
    listeners.message({ origin, source: parent, data: { type: 'spmt-lounge-brb-audio', active } });
  } };
}

test('BRB mutes only this viewer and restores the prior unmuted state', () => {
  const viewer = createViewer(false);
  viewer.send(true);
  assert.equal(viewer.video.muted, true);
  viewer.send(true);
  viewer.send(false);
  assert.equal(viewer.video.muted, false);
});

test('a viewer muted before BRB stays muted, and other origins cannot change it', () => {
  const viewer = createViewer(true);
  viewer.send(true, 'https://other.example');
  assert.equal(viewer.video.muted, true);
  viewer.send(true);
  viewer.send(false);
  assert.equal(viewer.video.muted, true);
});
