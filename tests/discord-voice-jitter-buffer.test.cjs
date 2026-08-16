'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DiscordPcmJitterSource,
  attackPcm16,
  releasePcm16,
} = require('../worker/src/discord-pcm-jitter');

function pcmFrame(values) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeInt16LE(value, index * 2));
  return out;
}

function repeatedFrames(count, value = 1000) {
  return Buffer.concat(Array.from({ length: count }, () => pcmFrame([value, value, value, value])));
}

test('uses a quality-first Discord playout buffer of at least 600ms', () => {
  const source = new DiscordPcmJitterSource({
    frameBytes: 8,
    targetFrames: 3,
    maxFrames: 10,
  });

  assert.equal(source.snapshot().targetFrames, 30);
  assert.ok(source.snapshot().maxFrames >= 80);
  source.push(repeatedFrames(29), 1000);
  assert.equal(source.nextFrame(1000), null, '29 frames should remain buffered');
  source.push(pcmFrame([2000, 2000, 2000, 2000]), 1000);
  assert.ok(source.nextFrame(1000), '30 frames should start playout');
});

test('short utterances start after the 800ms quality wait instead of being dropped', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8 });
  source.push(repeatedFrames(4, 5000), 1000);
  assert.equal(source.nextFrame(1799), null);
  const first = source.nextFrame(1800);
  assert.ok(first);
  assert.equal(source.snapshot().starts, 1);
});

test('speech attack ramps up instead of snapping from zero to arbitrary PCM', () => {
  const speech = pcmFrame([20000, -20000, 16000, -16000]);
  const first = attackPcm16(speech, 0, 4);
  assert.ok(Math.abs(first.readInt16LE(0)) < Math.abs(speech.readInt16LE(0)));
  assert.ok(Math.abs(first.readInt16LE(6)) < Math.abs(speech.readInt16LE(6)));
});

test('speech release ramps last channel samples to zero without repeating the final waveform', () => {
  const speech = pcmFrame([20000, -15000, 12000, -9000]);
  const released = releasePcm16(speech, 0, 4, 2);
  assert.notDeepEqual(released, speech, 'release must not replay the final 20ms speech frame');
  assert.equal(released.readInt16LE(0), 12000);
  assert.equal(released.readInt16LE(2), -9000);
  assert.ok(Math.abs(released.readInt16LE(4)) < 12000);
  assert.ok(Math.abs(released.readInt16LE(6)) < 9000);
});

test('drained speech emits a smooth release and reports no repeated-frame concealment', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, attackFrames: 0, releaseFrames: 4 });
  source.push(repeatedFrames(2, 12000), 1000);
  assert.ok(source.nextFrame(1800));
  assert.ok(source.nextFrame(1820));
  const release1 = source.nextFrame(1840);
  const release2 = source.nextFrame(1860);
  assert.ok(release1);
  assert.ok(release2);
  assert.equal(source.snapshot().concealedFrames, 0);
  assert.ok(source.snapshot().releases >= 1);
});

test('caps excessive backlog on whole PCM frames while leaving generous headroom', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8 });
  source.push(Buffer.concat(Array.from({ length: 100 }, (_, i) => pcmFrame([i, i, i, i]))), 1000);
  assert.ok(source.snapshot().bufferedFrames <= 80);
  assert.ok(source.snapshot().droppedFrames >= 20);
  assert.equal(source.buf.length % 8, 0);
});

test('keeps each Discord receive subscription alive until the member leaves the VC', () => {
  const bridgeSource = fs.readFileSync(
    path.join(__dirname, '..', 'worker', 'src', 'discord-voice-bridge.js'),
    'utf8',
  );
  assert.match(bridgeSource, /behavior:\s*EndBehaviorType\.Manual/);
  assert.doesNotMatch(bridgeSource, /behavior:\s*EndBehaviorType\.AfterSilence/);
});
