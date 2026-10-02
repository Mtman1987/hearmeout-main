import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacy = readFileSync(new URL('../src/lib/lounge-player-html.ts', import.meta.url), 'utf8');
const direct = readFileSync(new URL('../src/app/lounge-media/direct/page.tsx', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../public/lounge-media/worker-media.html', import.meta.url), 'utf8');

test('BRB never mutes HearMeOut media', () => {
  assert.match(legacy, /video\.muted=sourceMuted;/);
  assert.doesNotMatch(legacy, /video\.muted=sourceMuted\|\|brbActive/);
  assert.match(direct, /video\.muted = muted;/);
  assert.doesNotMatch(direct, /spmt-lounge-brb-audio/);
  assert.match(worker, /video\.muted = muted \|\| programMuted;/);
});

test('commercial breaks never start or replace audio inside the HearMeOut program player', () => {
  for (const source of [legacy, worker]) {
    assert.doesNotMatch(source, /spmt-lounge-brb-audio/);
    assert.doesNotMatch(source, /commercialActive|beginCommercialMusic|setThemeActive|themeTracks/);
    assert.doesNotMatch(source, /<audio id="theme"/);
  }
});
