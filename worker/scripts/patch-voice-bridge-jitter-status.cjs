'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'discord-voice-bridge.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const marker = `    const discordJitter = jitterSources.reduce((summary, source) => ({
      bufferedFrames: summary.bufferedFrames + source.bufferedFrames,
      bufferedMs: summary.bufferedMs + source.bufferedMs,
      concealedFrames: summary.concealedFrames + source.concealedFrames,
      underruns: summary.underruns + source.underruns,
      rebuffers: summary.rebuffers + source.rebuffers,
      lateFrames: summary.lateFrames + source.lateFrames,
      droppedFrames: summary.droppedFrames + source.droppedFrames,
      arrivalJitterMs: Math.max(summary.arrivalJitterMs, source.arrivalJitterMs),
      targetMs: Math.max(summary.targetMs, source.targetMs),
    }), { bufferedFrames: 0, bufferedMs: 0, concealedFrames: 0, underruns: 0, rebuffers: 0, lateFrames: 0, droppedFrames: 0, arrivalJitterMs: 0, targetMs: 0 });`;

const replacement = `    // Each Discord user owns an independent jitter buffer. Summing the five
    // users' buffered milliseconds and comparing that total to one user's
    // target made the UI look wildly unstable (for example 340/360 ms) even
    // when no single speaker was anywhere near that value. Report the worst
    // individual source for the live health line, and keep totals separately
    // for diagnostics.
    const jitterTotals = jitterSources.reduce((summary, source) => ({
      bufferedMs: summary.bufferedMs + source.bufferedMs,
      underruns: summary.underruns + source.underruns,
      droppedFrames: summary.droppedFrames + source.droppedFrames,
    }), { bufferedMs: 0, underruns: 0, droppedFrames: 0 });
    const discordJitter = jitterSources.reduce((summary, source) => ({
      bufferedFrames: Math.max(summary.bufferedFrames, source.bufferedFrames),
      bufferedMs: Math.max(summary.bufferedMs, source.bufferedMs),
      concealedFrames: Math.max(summary.concealedFrames, source.concealedFrames),
      underruns: Math.max(summary.underruns, source.underruns),
      rebuffers: Math.max(summary.rebuffers, source.rebuffers),
      lateFrames: Math.max(summary.lateFrames, source.lateFrames),
      droppedFrames: Math.max(summary.droppedFrames, source.droppedFrames),
      arrivalJitterMs: Math.max(summary.arrivalJitterMs, source.arrivalJitterMs),
      targetMs: Math.max(summary.targetMs, source.targetMs),
    }), { bufferedFrames: 0, bufferedMs: 0, concealedFrames: 0, underruns: 0, rebuffers: 0, lateFrames: 0, droppedFrames: 0, arrivalJitterMs: 0, targetMs: 0 });
    discordJitter.sourceCount = jitterSources.length;
    discordJitter.totalBufferedMs = jitterTotals.bufferedMs;
    discordJitter.totalUnderruns = jitterTotals.underruns;
    discordJitter.totalDroppedFrames = jitterTotals.droppedFrames;`;

if (!source.includes(marker)) {
  if (source.includes('discordJitter.totalUnderruns = jitterTotals.underruns')) {
    console.log('Voice bridge per-speaker jitter status patch already applied.');
    process.exit(0);
  }
  throw new Error('Voice bridge jitter status marker missing');
}

source = source.replace(marker, replacement);

for (const expected of [
  'bufferedMs: Math.max(summary.bufferedMs, source.bufferedMs)',
  'discordJitter.totalUnderruns = jitterTotals.underruns',
  'discordJitter.totalDroppedFrames = jitterTotals.droppedFrames',
]) {
  if (!source.includes(expected)) throw new Error(`Voice bridge jitter status verification failed: ${expected}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Voice bridge per-speaker jitter status patch applied.');
