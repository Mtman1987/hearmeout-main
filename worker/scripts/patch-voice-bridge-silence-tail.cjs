'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'discord-voice-bridge.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const marker = `    if (frames.length === 0) {
      const now = Date.now();
      const withinTail = hasForwardableSource && now - this.lastAppAudioAt < APP_SILENCE_TAIL_MS;
      const canHeartbeat = now - this.lastSilenceAt >= SILENCE_HEARTBEAT_MS;
      if (!withinTail || !canHeartbeat) return;
      this.lastSilenceAt = now;
      out = VOICE_SILENCE_FRAME;
    } else if (frames.length === 1) {`;

const replacement = `    if (frames.length === 0) {
      const now = Date.now();
      const withinTail = hasForwardableSource && now - this.lastAppAudioAt < APP_SILENCE_TAIL_MS;
      if (!withinTail) return;

      // Keep the raw Discord encoder continuously clocked for the short voice
      // tail. The old code emitted one isolated 20 ms zero frame every 250 ms;
      // that repeatedly starved and woke the raw->Opus pipeline and was heard
      // as slow, random "popcorn" clicks even while nobody was speaking.
      // This is Discord-side zero PCM only; it does not create another LiveKit
      // track/participant or restore the removed music lane.
      out = VOICE_SILENCE_FRAME;
    } else if (frames.length === 1) {`;

if (!source.includes(marker)) {
  if (source.includes('The old code emitted one isolated 20 ms zero frame every 250 ms')) {
    console.log('Voice bridge continuous silence-tail patch already applied.');
    process.exit(0);
  }
  throw new Error('Voice bridge silence-tail patch marker missing');
}

source = source.replace(marker, replacement);

if (source.includes('if (!withinTail || !canHeartbeat) return;')) {
  throw new Error('Sparse Discord silence heartbeat survived the patch');
}
if (!source.includes('if (!withinTail) return;') || !source.includes('out = VOICE_SILENCE_FRAME;')) {
  throw new Error('Continuous Discord silence-tail verification failed');
}

fs.writeFileSync(file, source, 'utf8');
console.log('Voice bridge continuous silence-tail patch applied.');
