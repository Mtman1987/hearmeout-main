'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AUDIO_PROFILES,
  DiscordPcmJitterSource,
  fadePcm16Edge,
} = require('../worker/src/discord-pcm-jitter');

function pcmFrame(values) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeInt16LE(value, index * 2));
  return out;
}

function repeatedFrames(count, value = 1000) {
  return Buffer.concat(Array.from({ length: count }, () => pcmFrame([value, value, value, value])));
}

test('balanced profile starts with a bounded 160ms target instead of a fixed 600ms delay', () => {
  const source = new DiscordPcmJitterSource({
    frameBytes: 8,
    profile: 'balanced',
  });

  assert.equal(source.snapshot().targetFrames, 8);
  assert.equal(source.snapshot().targetMs, 160);
  source.push(repeatedFrames(7), 1000);
  assert.equal(source.nextFrame(1000), null, 'seven frames should remain buffered');
  source.push(pcmFrame([2000, 2000, 2000, 2000]), 1000);
  assert.ok(source.nextFrame(1000), 'eight frames should start playout');
});

test('short utterances start after the bounded profile wait instead of being dropped', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8 });
  source.push(repeatedFrames(4, 5000), 1000);
  assert.equal(source.nextFrame(1179), null);
  const first = source.nextFrame(1180);
  assert.ok(first);
  assert.equal(source.snapshot().starts, 1);
});

test('speech attack changes only the leading edge of a real frame', () => {
  const speech = pcmFrame([20000, -20000, 16000, -16000]);
  const first = fadePcm16Edge(speech, 'in', 1, 2);
  assert.ok(Math.abs(first.readInt16LE(0)) < Math.abs(speech.readInt16LE(0)));
  assert.equal(first.readInt16LE(6), speech.readInt16LE(6));
});

test('speech release fades the tail inside the real final frame', () => {
  const speech = pcmFrame([20000, -15000, 12000, -9000]);
  const released = fadePcm16Edge(speech, 'out', 1, 2);
  assert.equal(released.readInt16LE(0), speech.readInt16LE(0));
  assert.equal(released.readInt16LE(2), speech.readInt16LE(2));
  assert.equal(released.readInt16LE(4), 0);
  assert.equal(released.readInt16LE(6), 0);
});

test('drained speech never emits synthesized or repeated PCM frames', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'low-latency', fadeSamples: 1 });
  source.push(repeatedFrames(2, 12000), 1000);
  assert.ok(source.nextFrame(1100));
  assert.ok(source.nextFrame(1120));
  assert.equal(source.nextFrame(1140), null);
  assert.equal(source.nextFrame(1160), null);
  assert.equal(source.snapshot().concealedFrames, 0);
  assert.equal(source.snapshot().underruns, 1);
});

test('repeated underruns raise the adaptive target only within the selected profile limit', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'low-latency', fadeSamples: 1 });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const at = 1000 + cycle * 200;
    const frames = source.snapshot().targetFrames;
    source.push(repeatedFrames(frames), at);
    for (let frame = 0; frame < frames; frame += 1) assert.ok(source.nextFrame(at + frame * 20));
    source.nextFrame(at + frames * 20);
    source.nextFrame(at + frames * 20 + 20);
  }
  assert.equal(source.snapshot().targetFrames, AUDIO_PROFILES['low-latency'].adaptiveMaxFrames);
});

test('caps excessive backlog on whole PCM frames', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'balanced' });
  source.push(Buffer.concat(Array.from({ length: 100 }, (_, i) => pcmFrame([i, i, i, i]))), 1000);
  assert.ok(source.snapshot().bufferedFrames <= AUDIO_PROFILES.balanced.maxFrames);
  assert.ok(source.snapshot().droppedFrames >= 68);
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
