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

test('drained speech is a normal pause and does not inflate underrun or target counters', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'low-latency', fadeSamples: 1 });
  source.push(repeatedFrames(4, 12000), 1000);
  assert.ok(source.nextFrame(1000));
  assert.ok(source.nextFrame(1020));
  assert.ok(source.nextFrame(1040));
  assert.ok(source.nextFrame(1060));
  assert.equal(source.nextFrame(1080), null);
  assert.equal(source.nextFrame(1100), null);

  const idle = source.snapshot();
  assert.equal(idle.concealedFrames, 0);
  assert.equal(idle.underruns, 0);
  assert.equal(idle.targetFrames, AUDIO_PROFILES['low-latency'].targetFrames);

  // A later utterance should re-prime as speech, not be treated as a network
  // underrun simply because Discord emitted no PCM while the user was quiet.
  source.push(repeatedFrames(4, 9000), 1300);
  assert.ok(source.nextFrame(1300));
  assert.equal(source.snapshot().underruns, 0);
  assert.equal(source.snapshot().speechRestarts, 1);
});

test('a short producer gap after the playout buffer drains is a real adaptive underrun', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'low-latency', fadeSamples: 1 });
  source.push(repeatedFrames(4, 12000), 1000);
  assert.ok(source.nextFrame(1000));
  assert.ok(source.nextFrame(1020));
  assert.ok(source.nextFrame(1040));
  assert.ok(source.nextFrame(1060));

  // Final frame drained at 1060; PCM resuming 40 ms later means the transport
  // starved mid-utterance, not that a human naturally paused for a new phrase.
  source.push(repeatedFrames(6, 12000), 1100);
  assert.equal(source.snapshot().underruns, 1);
  assert.equal(source.snapshot().rebuffers, 1);
  assert.equal(source.snapshot().lateFrames, 1);
  assert.equal(source.snapshot().targetFrames, 6);
  assert.ok(source.nextFrame(1100));
});

test('repeated short transport gaps raise the adaptive target only within the selected profile limit', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'low-latency', fadeSamples: 1 });
  let now = 1000;

  for (let cycle = 0; cycle < 8; cycle += 1) {
    const target = source.snapshot().targetFrames;
    const missing = Math.max(0, target - source.bufferedFrames());
    if (missing) source.push(repeatedFrames(missing), now);

    for (let frame = 0; frame < target; frame += 1) {
      assert.ok(source.nextFrame(now + frame * 20));
    }

    const finalFrameAt = now + (target - 1) * 20;
    const resumeAt = finalFrameAt + 40;
    source.push(pcmFrame([1000, 1000, 1000, 1000]), resumeAt);
    now = resumeAt;
  }

  assert.equal(source.snapshot().targetFrames, AUDIO_PROFILES['low-latency'].adaptiveMaxFrames);
  assert.ok(source.snapshot().underruns > 0);
});

test('PCM arrival jitter uses the previous decoded chunk duration', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'balanced' });

  // Four 20 ms frames should make the next decoder callback naturally arrive
  // about 80 ms later, regardless of how many frames the next callback holds.
  source.push(repeatedFrames(4), 1000);
  source.push(pcmFrame([1000, 1000, 1000, 1000]), 1080);
  assert.equal(source.snapshot().arrivalJitterMs, 0);
});

test('normal silence between speech bursts does not count as PCM arrival jitter', () => {
  const source = new DiscordPcmJitterSource({ frameBytes: 8, profile: 'balanced' });

  source.push(repeatedFrames(4), 1000);
  source.push(repeatedFrames(4), 1080);
  assert.equal(source.snapshot().arrivalJitterMs, 0);

  // The previous chunk represents 80 ms of PCM. Returning 420 ms later leaves
  // a 340 ms human-silence gap, which starts a new talk spurt instead of
  // polluting the jitter metric.
  source.push(repeatedFrames(4), 1500);
  assert.equal(source.snapshot().arrivalJitterMs, 0);
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
