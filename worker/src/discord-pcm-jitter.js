'use strict';

// Discord supplies decoded PCM in bursty chunks while LiveKit consumes an
// exact 20 ms clock. Keep a bounded adaptive playout buffer, but never invent
// extra speech frames: replaying or stretching the final PCM sample is what
// created the audible "machine-gun" edges during an underrun.

const AUDIO_PROFILES = Object.freeze({
  'low-latency': Object.freeze({
    targetFrames: 4,
    maxFrames: 20,
    adaptiveMaxFrames: 10,
    maxStartupWaitMs: 100,
    fadeSamples: 120,
  }),
  balanced: Object.freeze({
    targetFrames: 8,
    maxFrames: 32,
    adaptiveMaxFrames: 18,
    maxStartupWaitMs: 180,
    fadeSamples: 144,
  }),
  resilient: Object.freeze({
    targetFrames: 14,
    maxFrames: 48,
    adaptiveMaxFrames: 28,
    maxStartupWaitMs: 320,
    fadeSamples: 192,
  }),
});

function normalizeAudioProfile(value) {
  const profile = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUDIO_PROFILES, profile) ? profile : 'balanced';
}

class DiscordPcmJitterSource {
  constructor({
    frameBytes,
    channels = 2,
    frameDurationMs = 20,
    profile = 'balanced',
    targetFrames,
    maxFrames,
    adaptiveMaxFrames,
    maxStartupWaitMs,
    fadeSamples,
  } = {}) {
    if (!Number.isInteger(frameBytes) || frameBytes <= 0 || frameBytes % 2 !== 0) {
      throw new Error('frameBytes must be a positive even integer');
    }
    this.frameBytes = frameBytes;
    this.channels = Math.max(1, Number(channels) || 2);
    this.frameDurationMs = Math.max(1, Number(frameDurationMs) || 20);
    this.buf = Buffer.alloc(0);
    this.started = false;
    this.starved = false;
    this.needsAttack = false;
    this.firstPacketAt = 0;
    this.lastPushAt = 0;
    this.arrivalJitterMs = 0;
    this.stableFrames = 0;
    this.stats = {
      starts: 0,
      speechEnds: 0,
      underruns: 0,
      rebuffers: 0,
      lateFrames: 0,
      droppedFrames: 0,
      concealedFrames: 0,
    };
    this.configure({
      profile,
      targetFrames,
      maxFrames,
      adaptiveMaxFrames,
      maxStartupWaitMs,
      fadeSamples,
    });
  }

  configure({ profile, targetFrames, maxFrames, adaptiveMaxFrames, maxStartupWaitMs, fadeSamples } = {}) {
    this.profile = normalizeAudioProfile(profile || this.profile);
    const defaults = AUDIO_PROFILES[this.profile];
    this.baseTargetFrames = clampInteger(targetFrames, defaults.targetFrames, 2, 30);
    this.adaptiveMaxFrames = clampInteger(
      adaptiveMaxFrames,
      defaults.adaptiveMaxFrames,
      this.baseTargetFrames,
      60,
    );
    this.targetFrames = Math.max(
      this.baseTargetFrames,
      Math.min(this.targetFrames || this.baseTargetFrames, this.adaptiveMaxFrames),
    );
    this.maxFrames = clampInteger(
      maxFrames,
      defaults.maxFrames,
      this.adaptiveMaxFrames + 2,
      120,
    );
    this.maxStartupWaitMs = clampInteger(maxStartupWaitMs, defaults.maxStartupWaitMs, 40, 1000);
    this.fadeSamples = clampInteger(fadeSamples, defaults.fadeSamples, 24, 480);
    return this.snapshot();
  }

  setProfile(profile) {
    const normalized = normalizeAudioProfile(profile);
    const defaults = AUDIO_PROFILES[normalized];
    this.profile = normalized;
    this.baseTargetFrames = defaults.targetFrames;
    this.targetFrames = defaults.targetFrames;
    this.adaptiveMaxFrames = defaults.adaptiveMaxFrames;
    this.maxFrames = defaults.maxFrames;
    this.maxStartupWaitMs = defaults.maxStartupWaitMs;
    this.fadeSamples = defaults.fadeSamples;
    return this.snapshot();
  }

  push(pcm, now = Date.now()) {
    if (!pcm || pcm.length === 0) return;
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    if (!this.firstPacketAt) this.firstPacketAt = now;
    if (this.lastPushAt) {
      const frames = Math.max(1, Math.floor(bytes.length / this.frameBytes));
      const expectedGap = frames * this.frameDurationMs;
      const observedJitter = Math.abs((now - this.lastPushAt) - expectedGap);
      this.arrivalJitterMs = this.arrivalJitterMs
        ? this.arrivalJitterMs * 0.9 + observedJitter * 0.1
        : observedJitter;
    }
    this.lastPushAt = now;
    if (this.starved && this.started) {
      this.needsAttack = true;
      this.starved = false;
      this.stats.lateFrames += 1;
    }
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
    return Boolean(this.firstPacketAt && now - this.firstPacketAt >= this.maxStartupWaitMs);
  }

  beginPlayout() {
    this.started = true;
    this.starved = false;
    this.needsAttack = true;
    this.stats.starts += 1;
  }

  recordUnderrun(now) {
    this.started = false;
    this.starved = false;
    this.needsAttack = false;
    this.firstPacketAt = this.buf.length ? now : 0;
    this.stableFrames = 0;
    this.stats.underruns += 1;
    this.stats.rebuffers += 1;
    // Adapt quickly to a poor route, but remain far below the old fixed 600ms
    // delay. Stable playback gradually returns to the selected profile.
    this.targetFrames = Math.min(this.adaptiveMaxFrames, this.targetFrames + 2);
  }

  nextFrame(now = Date.now()) {
    if (!this.started) {
      if (!this.shouldStart(now)) return null;
      this.beginPlayout();
    }

    if (this.buf.length < this.frameBytes) {
      if (this.starved) this.recordUnderrun(now);
      else this.starved = true;
      return null;
    }

    let frame = Buffer.from(this.buf.subarray(0, this.frameBytes));
    this.buf = this.buf.subarray(this.frameBytes);
    if (this.needsAttack) {
      frame = fadePcm16Edge(frame, 'in', this.fadeSamples, this.channels);
      this.needsAttack = false;
    }

    if (this.buf.length < this.frameBytes) {
      // Fade only the tail of the real final frame. Do not synthesize/replay
      // another 20ms frame from its last samples.
      frame = fadePcm16Edge(frame, 'out', this.fadeSamples, this.channels);
      this.starved = true;
      this.stats.speechEnds += 1;
    } else {
      this.starved = false;
      this.stableFrames += 1;
      if (this.stableFrames >= 1500 && this.targetFrames > this.baseTargetFrames) {
        this.targetFrames -= 1;
        this.stableFrames = 0;
      }
    }
    return frame;
  }

  snapshot() {
    return {
      profile: this.profile,
      bufferedFrames: this.bufferedFrames(),
      bufferedMs: this.bufferedFrames() * this.frameDurationMs,
      started: this.started,
      starved: this.starved,
      targetFrames: this.targetFrames,
      targetMs: this.targetFrames * this.frameDurationMs,
      maxFrames: this.maxFrames,
      maxStartupWaitMs: this.maxStartupWaitMs,
      arrivalJitterMs: Math.round(this.arrivalJitterMs * 10) / 10,
      ...this.stats,
    };
  }
}

function fadePcm16Edge(frame, direction, fadeSamples = 144, channels = 2) {
  const out = Buffer.from(frame);
  const sampleCount = out.length / 2;
  const channelCount = Math.max(1, Math.min(Number(channels) || 1, sampleCount));
  const framesPerChannel = Math.floor(sampleCount / channelCount);
  const fadeFrameCount = Math.max(1, Math.min(Number(fadeSamples) || 1, framesPerChannel));
  const startFrame = direction === 'out' ? framesPerChannel - fadeFrameCount : 0;
  const endFrame = direction === 'out' ? framesPerChannel : fadeFrameCount;

  for (let sampleFrame = startFrame; sampleFrame < endFrame; sampleFrame += 1) {
    const offset = sampleFrame - startFrame;
    const progress = fadeFrameCount <= 1 ? 0 : offset / (fadeFrameCount - 1);
    const gain = fadeFrameCount <= 1 ? 0 : direction === 'out' ? 1 - progress : progress;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const index = sampleFrame * channelCount + channel;
      out.writeInt16LE(Math.round(out.readInt16LE(index * 2) * gain), index * 2);
    }
  }
  return out;
}

// Compatibility helpers retained for older callers/tests. They now operate
// inside a real frame instead of fabricating multiple release frames.
function attackPcm16(frame, _step = 0, totalSteps = 144, channels = 2) {
  return fadePcm16Edge(frame, 'in', totalSteps, channels);
}

function releasePcm16(frame, _step = 0, totalSteps = 144, channels = 2) {
  return fadePcm16Edge(frame, 'out', totalSteps, channels);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.max(min, Math.min(max, resolved));
}

module.exports = {
  AUDIO_PROFILES,
  DiscordPcmJitterSource,
  normalizeAudioProfile,
  fadePcm16Edge,
  attackPcm16,
  releasePcm16,
};
