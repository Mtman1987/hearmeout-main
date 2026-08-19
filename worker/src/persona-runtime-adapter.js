'use strict';

const { spawn } = require('child_process');

const DEFAULT_START_RMS = 300;
const DEFAULT_CONTINUE_RMS = 180;
const DEFAULT_SILENCE_MS = 650;
const DEFAULT_MIN_SPEECH_MS = 180;
const DEFAULT_MAX_UTTERANCE_MS = 12_000;
const DEFAULT_PRE_ROLL_MS = 220;

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function rmsPcm16(pcm) {
  if (!pcm || pcm.length < 2) return 0;
  const samples = Math.floor(pcm.length / 2);
  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const value = pcm.readInt16LE(offset);
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / Math.max(1, samples));
}

function isHumanRoomIdentity(identity) {
  const value = clean(identity, 160).toLowerCase();
  if (!value) return false;
  return !(
    value.startsWith('persona:')
    || value.startsWith('discord-')
    || value.startsWith('dj-')
    || value.startsWith('dj-worker-')
    || value.startsWith('music-')
    || value.startsWith('listener-')
  );
}

function wakeNameMatches(transcript, wakeNames = []) {
  const value = clean(transcript).toLowerCase();
  if (!value) return false;
  return wakeNames.some((entry) => {
    const wake = clean(entry, 96).replace(/^@/, '').toLowerCase();
    if (!wake) return false;
    const escaped = wake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])@?${escaped}([^a-z0-9_]|$)`, 'i').test(value);
  });
}

function shouldRouteTranscript(
  transcript,
  wakeNames,
  interests = [],
  interestChance = 0.35,
  random = Math.random,
) {
  const value = clean(transcript);
  if (!value || /^could not understand audio\.?$/i.test(value)) return false;
  if (wakeNameMatches(value, wakeNames)) return true;
  if (value.startsWith('!') || !wakeNameMatches(value, interests)) return false;
  return random() < Math.max(0, Math.min(1, Number(interestChance) || 0));
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

async function pcmToWebmOpus(pcm) {
  return runFfmpeg([
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '1',
    '-i', 'pipe:0',
    '-c:a', 'libopus',
    '-application', 'voip',
    '-b:a', '48k',
    '-f', 'webm',
    'pipe:1',
  ], pcm);
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
    persona,
    roomId,
    personaId,
    displayName,
    ownerTenantId,
    wakeNames = [],
    aliases = [],
    interests = [],
    voice = '',
    appUrl,
    workerHeaders = {},
    accessToken,
    refreshToken,
    personaCount = () => 1,
  }) {
    this.persona = persona;
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
    this.voice = clean(voice, 128);
    this.interests = Array.from(new Set(
      interests.map((entry) => clean(entry, 96)).filter(Boolean),
    ));
    this.appUrl = String(appUrl || '').replace(/\/$/, '');
    this.workerHeaders = workerHeaders;
    this.accessToken = clean(accessToken, 10000);
    this.refreshToken = clean(refreshToken, 10000);
    this.personaCount = personaCount;
    this.unsubscribe = null;
    this.states = new Map();
    this.queue = Promise.resolve();
    this.stopped = false;
  }

  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.persona.onAudioFrame((frame) => this.onAudioFrame(frame));
  }

  stop() {
    this.stopped = true;
    try { this.unsubscribe?.(); } catch {}
    this.unsubscribe = null;
    this.states.clear();
  }

  stateFor(identity) {
    let state = this.states.get(identity);
    if (!state) {
      state = {
        active: false,
        chunks: [],
        preRoll: [],
        preRollMs: 0,
        speechMs: 0,
        silenceMs: 0,
        totalMs: 0,
      };
      this.states.set(identity, state);
    }
    return state;
  }

  resetState(state) {
    state.active = false;
    state.chunks = [];
    state.speechMs = 0;
    state.silenceMs = 0;
    state.totalMs = 0;
  }

  onAudioFrame(frame) {
    if (this.stopped || !isHumanRoomIdentity(frame.identity)) return;
    const pcm = Buffer.from(frame.pcm || []);
    if (!pcm.length) return;
    const durationMs = Math.max(1, Math.round((Number(frame.samplesPerChannel || 0) / Number(frame.sampleRate || 48000)) * 1000));
    const rms = rmsPcm16(pcm);
    const state = this.stateFor(frame.identity);

    if (!state.active) {
      state.preRoll.push(Buffer.from(pcm));
      state.preRollMs += durationMs;
      while (state.preRollMs > DEFAULT_PRE_ROLL_MS && state.preRoll.length > 1) {
        state.preRoll.shift();
        state.preRollMs -= durationMs;
      }
      if (rms < DEFAULT_START_RMS) return;
      state.active = true;
      state.chunks = state.preRoll.splice(0);
      state.preRollMs = 0;
      state.speechMs = durationMs;
      state.silenceMs = 0;
      state.totalMs = state.chunks.length * durationMs;
      return;
    }

    state.chunks.push(Buffer.from(pcm));
    state.totalMs += durationMs;
    if (rms >= DEFAULT_CONTINUE_RMS) {
      state.speechMs += durationMs;
      state.silenceMs = 0;
    } else {
      state.silenceMs += durationMs;
    }

    if (state.silenceMs >= DEFAULT_SILENCE_MS || state.totalMs >= DEFAULT_MAX_UTTERANCE_MS) {
      const utterance = state.speechMs >= DEFAULT_MIN_SPEECH_MS ? Buffer.concat(state.chunks) : null;
      this.resetState(state);
      if (utterance?.length) {
        this.queue = this.queue
          .then(() => this.processUtterance(frame.identity, utterance))
          .catch((error) => console.warn(`[Persona:${this.personaId}] utterance failed:`, error?.message || error));
      }
    }
  }

  async transcribe(pcm) {
    const webm = await pcmToWebmOpus(pcm);
    const response = await fetch(`${this.appUrl}/api/internal/persona-transcribe`, {
      method: 'POST',
      headers: { ...this.workerHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ base64Audio: webm.toString('base64') }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(50_000) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(payload?.error || `STT returned ${response.status}`, 1000));
    return clean(payload?.transcription || payload?.data?.transcription, 5000);
  }

  async runCommand(transcript) {
    if (!this.accessToken) throw new Error('Persona has no SPMT access token; re-invite the bot');
    const response = await fetch(`${this.appUrl}/api/internal/persona-command`, {
      method: 'POST',
      headers: { ...this.workerHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        command: transcript,
        roomId: this.roomId,
        targetTenantId: this.ownerTenantId,
        voice: this.voice || undefined,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken || undefined,
      }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(70_000) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    const session = payload?.personaSession;
    if (session?.accessToken) this.accessToken = clean(session.accessToken, 10000);
    if (session?.refreshToken) this.refreshToken = clean(session.refreshToken, 10000);
    if (!response.ok) throw new Error(clean(payload?.error?.message || payload?.error || `Bot runtime returned ${response.status}`, 1000));
    return payload;
  }

  async playAudioDataUri(dataUri) {
    if (!dataUri || this.stopped) return false;
    const pcm = await audioDataUriToPcm(dataUri);
    if (this.stopped || !pcm.length) return false;
    await this.persona.pushPcm(pcm);
    return true;
  }

  async processUtterance(identity, pcm) {
    if (this.stopped) return;
    const transcript = await this.transcribe(pcm);
    const roomPersonaCount = Math.max(1, Number(this.personaCount()) || 1);
    const interestChance = Math.min(0.35, 1 / Math.max(2, roomPersonaCount * 2));
    if (!shouldRouteTranscript(transcript, this.wakeNames, this.interests, interestChance)) return;
    console.log(`[Persona:${this.personaId}] heard ${identity}: ${transcript.slice(0, 160)}`);
    const payload = await this.runCommand(transcript);
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const responseText = clean(data?.response, 5000);
    const audioDataUri = clean(data?.tts?.audioDataUri || payload?.tts?.audioDataUri, 30_000_000);
    if (responseText) console.log(`[Persona:${this.personaId}] response ready (${responseText.length} chars)`);
    if (audioDataUri) await this.playAudioDataUri(audioDataUri);
  }

  status() {
    return {
      active: !this.stopped,
      roomId: this.roomId,
      personaId: this.personaId,
      displayName: this.displayName,
      voice: this.voice || undefined,
      interests: this.interests,
      listeners: this.states.size,
      authenticated: !!this.accessToken,
    };
  }
}

module.exports = {
  PersonaRuntimeAdapter,
  audioDataUriToPcm,
  isHumanRoomIdentity,
  rmsPcm16,
  shouldRouteTranscript,
  wakeNameMatches,
};
