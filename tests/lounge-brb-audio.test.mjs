import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacy = readFileSync(new URL('../src/lib/lounge-player-html.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../public/lounge-media/worker-media.html', import.meta.url), 'utf8');

test('BRB never mutes HearMeOut media', () => {
  assert.match(legacy, /video\.muted=sourceMuted;/);
  assert.doesNotMatch(legacy, /video\.muted=sourceMuted\|\|brbActive/);
  assert.match(worker, /video\.muted = muted \|\| programMuted;/);
});

test('commercial music starts for every BRB mode and stays latched through one full song', () => {
  assert.match(legacy, /setThemeActive\(brbActive\);/);
  assert.match(legacy, /if\(!commercialActive&&!failed\)\{themeActive=false;theme\.pause\(\);return\}/);
  assert.match(worker, /if \(commercialActive\) beginCommercialMusic\(\);/);
  assert.match(worker, /if \(!commercialActive && !failed\) \{ themeLatched = false; theme\.pause\(\); return; \}/);
});
