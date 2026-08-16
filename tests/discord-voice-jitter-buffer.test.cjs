'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DiscordPcmJitterSource,
  concealPcm16,
} = require('../worker/src/discord-pcm-jitter');

function pcmFrame(values) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeInt16LE(value, index * 2));
  return out;
}

test('prebuffers Discord PCM before playout so normal packet jitter does not create hard silence gaps', () => {
  const source = new DiscordPcmJitterSource({
    frameBytes: 8,
    targetFrames: 3,
    maxFrames: 10,
    concealFrames: 2,
    fadeSamples: 1,
  });

  source.push(Buffer.concat([
    pcmFrame([1000, 1000, 1000, 1000]),
    pcmFrame([2000, 2000, 2000, 2000]),
  ]));
  assert.equal(source.nextFrame(), null, 'two frames should remain buffered instead of creating a click-prone early start');

  source.push(pcmFrame([3000, 3000, 3000, 3000]));
  const first = source.nextFrame();
  assert.ok(first);
  assert.equal(source.snapshot().started, true);
  assert.equal(source.snapshot().bufferedFrames, 2);
});

test('conceals short underruns instead of snapping active speech directly to digital zero', () => {
  const source = new DiscordPcmJitterSource({
    frameBytes: 8,
    targetFrames: 1,
    maxFrames: 4,
    concealFrames: 2,
    fadeSamples: 0,
  });
  const speech = pcmFrame([12000, -12000, 10000, -10000]);
  source.push(speech);

  assert.deepEqual(source.nextFrame(), speech);
  const concealed1 = source.nextFrame();
  const concealed2 = source.nextFrame();
  assert.ok(concealed1);
  assert.ok(concealed2);
  assert.notDeepEqual(concealed1, Buffer.alloc(8));
  assert.notDeepEqual(concealed2, Buffer.alloc(8));
  assert.equal(source.nextFrame(), null);
  assert.equal(source.snapshot().concealedFrames, 2);
  assert.equal(source.snapshot().rebuffers, 1);
});

test('concealment fades down rather than repeating the previous PCM frame at full amplitude', () => {
  const speech = pcmFrame([20000, -20000, 16000, -16000]);
  const concealed = concealPcm16(speech, 0, 2);
  assert.ok(Math.abs(concealed.readInt16LE(0)) < Math.abs(speech.readInt16LE(0)));
  assert.ok(Math.abs(concealed.readInt16LE(6)) < Math.abs(concealed.readInt16LE(0)));
});

test('caps excessive jitter backlog by dropping whole PCM frames, preserving sample alignment', () => {
  const source = new DiscordPcmJitterSource({
    frameBytes: 8,
    targetFrames: 2,
    maxFrames: 4,
    concealFrames: 0,
    fadeSamples: 0,
  });
  source.push(Buffer.concat(Array.from({ length: 9 }, (_, i) => pcmFrame([i, i, i, i]))));
  assert.ok(source.snapshot().bufferedFrames <= 4);
  assert.ok(source.snapshot().droppedFrames >= 5);
  assert.equal(source.buf.length % 8, 0);
});
