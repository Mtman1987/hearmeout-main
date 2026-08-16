'use strict';

// Discord voice arrives in bursty Opus/PCM chunks while LiveKit consumes a
// strict 20 ms clock. This source deliberately trades latency for smoothness:
// it holds a deep playout buffer, ramps speech in, and synthesizes a clean
// release to zero instead of repeating the final speech frame at an underrun.

const MIN_TARGET_FRAMES = 30; // at least ~600 ms at the bridge's 20 ms frame size
const MIN_MAX_FRAMES = 80; // at least ~1.6 s of headroom
const MIN_STARTUP_WAIT_MS = 800;

class DiscordPcmJitterSource {
  constructor({
    frameBytes,
    channels = 2,
    targetFrames = MIN_TARGET_FRAMES,
    maxFrames = MIN_MAX_FRAMES,
    maxStartupWaitMs = MIN_STARTUP_WAIT_MS,
    attackFrames = 4,
    releaseFrames = 4,
  } = {}) {
    if (!Number.isInteger(frameBytes) || frameBytes <= 0 || frameBytes % 2 !== 0) {
      throw new Error('frameBytes must be a positive even integer');
    }
    this.frameBytes = frameBytes;
    this.channels = Math.max(1, Number(channels) || 2);
    // The bridge used to pass 3/10 here. Clamp old callers to the new
    // quality-first policy so a stale constant cannot silently restore the
    // click-prone 60 ms playout window.
    this.targetFrames = Math.max(MIN_TARGET_FRAMES, Number(targetFrames) || MIN_TARGET_FRAMES);
    this.maxFrames = Math.max(MIN_MAX_FRAMES, this.targetFrames + 1, Number(maxFrames) || MIN_MAX_FRAMES);
    this.maxStartupWaitMs = Math.max(MIN_STARTUP_WAIT_MS, Number(maxStartupWaitMs) || MIN_STARTUP_WAIT_MS);
    this.attackFrames = Math.max(0, Number(attackFrames) || 0);
    this.releaseFrames = Math.max(0, Number(releaseFrames) || 0);

    this.buf = Buffer.alloc(0);
    this.started = false;
    this.firstPacketAt = 0;
    this.lastFrame = null;
    this.attackStep = 0;
    this.releaseStep = -1;
    this.stats = {
      starts: 0,
      releases: 0,
      rebuffers: 0,
      droppedFrames: 0,
      // Kept for status compatibility with the first smoothing pass. We no
      // longer conceal by replaying speech because that repetition itself can
      // sound like a machine gun at Discord voice-activity edges.
      concealedFrames: 0,
    };
  }

  push(pcm, now = Date.now()) {
    if (!pcm || pcm.length === 0) return;
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    if (!this.firstPacketAt) this.firstPacketAt = now;
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

  shouldStart(now) {
    const buffered = this.bufferedFrames();
    if (buffered <= 0) return false;
    if (buffered >= this.targetFrames) return true;
    return !!this.firstPacketAt && now - this.firstPacketAt >= this.maxStartupWaitMs;
  }

  beginPlayout() {
    this.started = true;
    this.attackStep = 0;
    this.releaseStep = -1;
    this.stats.starts += 1;
  }

  beginRelease() {
    this.releaseStep = 0;
    // Any packets arriving while the release ramp is playing are a new burst.
    this.firstPacketAt = 0;
    this.stats.releases += 1;
  }

  finishRelease() {
    this.started = false;
    this.lastFrame = null;
    this.attackStep = 0;
    this.releaseStep = -1;
    this.stats.rebuffers += 1;
  }

  nextFrame(now = Date.now()) {
    // Once a release begins, finish that short ramp before starting a newly
    // arrived burst. That avoids snapping from a fade-out straight back into
    // arbitrary speech PCM.
    if (this.releaseStep >= 0) {
      if (!this.lastFrame || this.releaseFrames <= 0 || this.releaseStep >= this.releaseFrames) {
        this.finishRelease();
        return null;
      }
      const frame = releasePcm16(
        this.lastFrame,
        this.releaseStep,
        this.releaseFrames,
        this.channels,
      );
      this.releaseStep += 1;
      if (this.releaseStep >= this.releaseFrames) this.finishRelease();
      return frame;
    }

    if (!this.started) {
      if (!this.shouldStart(now)) return null;
      this.beginPlayout();
    }

    if (this.buf.length >= this.frameBytes) {
      let frame = Buffer.from(this.buf.subarray(0, this.frameBytes));
      this.buf = this.buf.subarray(this.frameBytes);
      if (this.attackFrames > 0 && this.attackStep < this.attackFrames) {
        frame = attackPcm16(frame, this.attackStep, this.attackFrames);
        this.attackStep += 1;
      }
      this.lastFrame = frame;
      return frame;
    }

    if (this.lastFrame && this.releaseFrames > 0) {
      this.beginRelease();
      return this.nextFrame(now);
    }

    this.finishRelease();
    return null;
  }

  snapshot() {
    return {
      bufferedFrames: this.bufferedFrames(),
      started: this.started,
      releasing: this.releaseStep >= 0,
      targetFrames: this.targetFrames,
      maxFrames: this.maxFrames,
      maxStartupWaitMs: this.maxStartupWaitMs,
      ...this.stats,
    };
  }
}

function attackPcm16(frame, step, totalSteps) {
  const out = Buffer.from(frame);
  const sampleCount = out.length / 2;
  const total = Math.max(1, totalSteps);
  const startGain = Math.max(0, Math.min(1, step / total));
  const endGain = Math.max(0, Math.min(1, (step + 1) / total));
  for (let i = 0; i < sampleCount; i += 1) {
    const progress = sampleCount <= 1 ? 1 : i / (sampleCount - 1);
    const gain = startGain + (endGain - startGain) * progress;
    out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * gain), i * 2);
  }
  return out;
}

function releasePcm16(lastFrame, step, totalSteps, channels = 2) {
  const out = Buffer.alloc(lastFrame.length);
  const sampleCount = out.length / 2;
  const channelCount = Math.max(1, Math.min(Number(channels) || 1, sampleCount));
  const samplesPerChannel = Math.floor(sampleCount / channelCount);
  const total = Math.max(1, totalSteps);
  const startGain = Math.max(0, 1 - step / total);
  const endGain = Math.max(0, 1 - (step + 1) / total);

  const lastValues = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const lastIndex = (samplesPerChannel - 1) * channelCount + channel;
    lastValues.push(lastFrame.readInt16LE(lastIndex * 2));
  }

  for (let sample = 0; sample < samplesPerChannel; sample += 1) {
    const progress = samplesPerChannel <= 1 ? 1 : sample / (samplesPerChannel - 1);
    const gain = startGain + (endGain - startGain) * progress;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const index = sample * channelCount + channel;
      out.writeInt16LE(Math.round(lastValues[channel] * gain), index * 2);
    }
  }
  return out;
}

module.exports = {
  DiscordPcmJitterSource,
  attackPcm16,
  releasePcm16,
};
