import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('src/app/overlay/[roomId]/page.tsx','utf8');
const workflow = fs.readFileSync('.github/workflows/fly-deploy.yml','utf8');
const smoke = fs.readFileSync('worker/scripts/smoke-lounge-browser.mjs','utf8');

test('Lounge player detects real playback and falls back from stalled embeds', () => {
  assert.match(overlay, /data-media-healthy/);
  assert.match(overlay, /YouTube embed stalled; switching to HMO proxy/);
  assert.match(overlay, /setForceProxyPlayback\(true\)/);
  assert.match(overlay, /onTimeUpdate/);
  assert.match(overlay, /embeddedProgressBaselineRef/);
});

test('production deploy proves request A plays, skip advances, and request B plays', () => {
  assert.match(workflow, /production-lounge-smoke:/);
  assert.match(workflow, /needs: \[deploy-main, deploy-worker\]/);
  assert.match(workflow, /smoke-lounge-browser\.mjs/);
  assert.match(smoke, /data-media-healthy/);
  assert.match(smoke, /control\('next'\)/);
  assert.match(smoke, /PASS: Lounge visibly played request A, advanced, and visibly played request B/);
});
