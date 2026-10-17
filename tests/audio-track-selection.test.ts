import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferredAudioTrackIndex } from '../src/lib/audio-track-selection';

test('prefers clean English over an English commentary track', () => {
  assert.equal(preferredAudioTrackIndex([
    { index: 0, name: 'English Commentary', language: 'en' },
    { index: 1, name: 'English', language: 'en' },
  ]), 1);
});

test('chooses a non-commentary track when no clean English track exists', () => {
  assert.equal(preferredAudioTrackIndex([
    { index: 0, name: 'English Commentary', language: 'en' },
    { index: 1, name: 'Français', language: 'fr' },
  ]), 1);
});

test('does not claim a clean track exists when all tracks are commentary', () => {
  assert.equal(preferredAudioTrackIndex([
    { index: 0, name: 'English Commentary', language: 'en' },
    { index: 1, name: 'Director Commentary', language: 'en' },
  ]), -1);
});

test('returns -1 when no tracks are advertised', () => {
  assert.equal(preferredAudioTrackIndex([]), -1);
});
