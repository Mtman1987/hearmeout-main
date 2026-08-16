'use strict';

// Discord voice packets do not arrive on the exact same 20 ms cadence as the
// LiveKit publisher clock. Feeding the publisher directly from the decoder can
// therefore alternate real PCM with hard zero-silence during tiny network or
// scheduler gaps, which is heard as sharp clicks. This source adds a small
// playout buffer and soft concealment without changing codecs or gain.

class DiscordPcmJitterSource {
  constructor({ frameBytes, targetFrames = 3, maxFrames = 10, concealFrames = 2, fadeSamples = 240 } = {}) {
    if (!Number.isInteger(frameBytes) || frameBytes <= 0 || frameBytes % 2 !== 0) {
      throw new Error('frameBytes must be a positive even integer');
    }
    this.frameBytes = frameBytes;
    this.targetFrames = Math.max(1, Number(targetFrames) || 3);
    this.maxFrames = Math.max(this.targetFrames + 1, Number(maxFrames) || 10);
    this.concealFrames = Math.max(0, Number(concealFrames) || 0);
    this.fadeSamples = Math.max(0, Number(fadeSamples) || 0);

    this.buf = Buffer.alloc(0);
    this.started = false;
    this.lastFrame = null;
    this.concealRemaining = this.concealFrames;
    this.fadeInPending = true;
    this.stats = {
      concealedFrames: 0,
      rebuffers: 0,
      droppedFrames: 0,
    };
  }

  push(pcm) {
    if (!pcm || pcm.length === 0) return;
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    this.buf = this.buf.length ? Buffer.concat([this.buf, bytes]) : Buffer.from(bytes);

    const maxBytes = this.maxFrames * this.frameBytes;
    if (this.buf.length > maxBytes) {
      const overflow = this.buf.length - maxBytes;
      const wholeFrames = Math.max(1, Math.ceil(overflow / this.frameBytes));
      const dropBytes = Math.min(wholeFrames * this.frameBytes, this.buf.length - this.frameBytes);
      this.buf = this.buf.subarray(dropBytes);
      this.stats.droppedFrames += Math.floor(dropBytes / this.frameBytes);
    }
  }

  bufferedFrames() {
    return Math.floor(this.buf.length / this.frameBytes);
  }

  nextFrame() {
    if (!this.started) {
      if (this.bufferedFrames() < this.targetFrames) return null;
      this.started = true;
      this.fadeInPending = true;
      this.concealRemaining = this.concealFrames;
    }

    if (this.buf.length >= this.frameBytes) {
      let frame = Buffer.from(this.buf.subarray(0, this.frameBytes));
      this.buf = this.buf.subarray(this.frameBytes);
      if (this.fadeInPending) {
        frame = fadeInPcm16(frame, this.fadeSamples);
        this.fadeInPending = false;
      }
      this.lastFrame = frame;
      this.concealRemaining = this.concealFrames;
      return frame;
    }

    if (this.lastFrame && this.concealRemaining > 0) {
      const step = this.concealFrames - this.concealRemaining;
      this.concealRemaining -= 1;
      this.stats.concealedFrames += 1;
      this.fadeInPending = true;
      return concealPcm16(this.lastFrame, step, this.concealFrames);
    }

    this.started = false;
    this.lastFrame = null;
    this.fadeInPending = true;
    this.concealRemaining = this.concealFrames;
    this.stats.rebuffers += 1;
    return null;
  }

  snapshot() {
    return {
      bufferedFrames: this.bufferedFrames(),
      started: this.started,
      ...this.stats,
    };
  }
}

function fadeInPcm16(frame, fadeSamples) {
  const out = Buffer.from(frame);
  const sampleCount = out.length / 2;
  const rampSamples = Math.min(sampleCount, Math.max(0, fadeSamples));
  if (!rampSamples) return out;
  for (let i = 0; i < rampSamples; i += 1) {
    const gain = (i + 1) / rampSamples;
    out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * gain), i * 2);
  }
  return out;
}

function concealPcm16(frame, step, totalSteps) {
  const out = Buffer.from(frame);
  const sampleCount = out.length / 2;
  const total = Math.max(1, totalSteps);
  const startGain = Math.max(0, 0.65 * (1 - step / total));
  const endGain = Math.max(0, 0.65 * (1 - (step + 1) / total));
  for (let i = 0; i < sampleCount; i += 1) {
    const progress = sampleCount <= 1 ? 1 : i / (sampleCount - 1);
    const gain = startGain + (endGain - startGain) * progress;
    out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * gain), i * 2);
  }
  return out;
}

module.exports = {
  DiscordPcmJitterSource,
  fadeInPcm16,
  concealPcm16,
};
