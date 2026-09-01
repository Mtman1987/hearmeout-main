'use strict';

const { spawn } = require('child_process');

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function runFfmpeg(args, input, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('ffmpeg timed out'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `ffmpeg exited ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function audioDataUriBytes(dataUri) {
  const value = clean(dataUri, 30_000_000);
  const match = /^data:audio\/[^;,]+(?:;[^,]*)?;base64,(.+)$/i.exec(value);
  if (!match) throw new Error('TTS response did not contain a supported audio data URI');
  return Buffer.from(match[1], 'base64');
}

async function audioDataUriToPcm(dataUri) {
  const encoded = audioDataUriBytes(dataUri);
  return runFfmpeg([
    '-i', 'pipe:0',
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '1',
    'pipe:1',
  ], encoded);
}

class PersonaRuntimeAdapter {
  constructor({
    roomId,
    personaId,
    displayName,
    ownerTenantId,
    wakeNames = [],
    aliases = [],
    interests = [],
    voice = '',
    accessToken,
    refreshToken,
    serviceSession = false,
  }) {
    this.roomId = roomId;
    this.personaId = personaId;
    this.displayName = displayName || personaId;
    this.ownerTenantId = ownerTenantId || personaId;
    this.wakeNames = Array.from(new Set([
      this.displayName,
      this.personaId,
      ...wakeNames,
      ...aliases,
    ].map((entry) => clean(entry, 96)).filter(Boolean)));
    this.interests = Array.from(new Set(interests.map((entry) => clean(entry, 96)).filter(Boolean)));
    this.voice = clean(voice, 128);
    this.accessToken = clean(accessToken, 10000);
    this.refreshToken = clean(refreshToken, 10000);
    this.serviceSession = !!serviceSession;
    this.stopped = false;
  }

  start() {
    // IMPORTANT: do not subscribe to room microphone audio here. HearMeOut has
    // exactly one human-speech path now: the browser records the already-live
    // LiveKit mic, uses the proven persona-transcribe endpoint, applies the
    // shared wake-name resolver, then calls /api/bot/commands. The worker only
    // owns persona RTC presence and outgoing TTS PCM.
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }

  status() {
    return {
      active: !this.stopped,
      roomId: this.roomId,
      personaId: this.personaId,
      displayName: this.displayName,
      voice: this.voice || undefined,
      wakeNames: this.wakeNames,
      wakePolicy: 'browser-vad-stt-explicit-name-only',
      speechInputRoute: 'browser-persona-transcribe-to-bot-commands',
      interests: this.interests,
      listeners: 0,
      authenticated: !!this.accessToken || this.serviceSession,
      authenticationMode: this.accessToken ? 'spmt' : this.serviceSession ? 'service' : 'none',
    };
  }
}

module.exports = {
  PersonaRuntimeAdapter,
  audioDataUriToPcm,
};
