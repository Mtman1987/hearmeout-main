'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'discord-voice-bridge.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function replaceOnce(marker, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(marker)) throw new Error(`Voice-only bridge patch marker missing: ${label}`);
  source = source.replace(marker, replacement);
}

replaceOnce(
  `const SAMPLE_RATE = 48000;\nconst CHANNELS = 2;\nconst SAMPLES_PER_FRAME = (SAMPLE_RATE * 20) / 1000; // 960 samples per 20ms\nconst BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2; // 3840 bytes (s16le stereo)\nconst SILENCE_FRAME = Buffer.alloc(BYTES_PER_FRAME);\nconst MAX_SOURCE_BACKLOG = BYTES_PER_FRAME * 10; // ~200ms jitter cap per source`,
  `const SAMPLE_RATE = 48000;\n// LiveKit carries only speech on this bridge. Keep that lane mono end-to-end;\n// Discord's raw playback boundary still expects 48 kHz stereo, so we upmix only\n// at the final Discord output edge. Music stays in Discord Activities.\nconst VOICE_CHANNELS = 1;\nconst DISCORD_OUTPUT_CHANNELS = 2;\nconst SAMPLES_PER_FRAME = (SAMPLE_RATE * 20) / 1000; // 960 samples per 20ms\nconst VOICE_BYTES_PER_FRAME = SAMPLES_PER_FRAME * VOICE_CHANNELS * 2; // 1920 bytes mono s16le\nconst DISCORD_BYTES_PER_FRAME = SAMPLES_PER_FRAME * DISCORD_OUTPUT_CHANNELS * 2; // 3840 bytes stereo s16le\nconst VOICE_SILENCE_FRAME = Buffer.alloc(VOICE_BYTES_PER_FRAME);\nconst MAX_SOURCE_BACKLOG = VOICE_BYTES_PER_FRAME * 10; // ~200ms jitter cap per source\nconst ACTIVE_DISCORD_SPEAKER_MS = 650;`,
  'audio constants',
);

replaceOnce(
  `    // Discord mix tick — combines jitter-buffered user PCM into one frame.\n    this.discordMixSources = new Map(); // userId -> DiscordPcmJitterSource\n    this.discordMixLoop = null;\n    this.discordCaptureErrors = 0;`,
  `    // Discord mix tick — combines jitter-buffered user PCM into one mono frame.\n    this.discordMixSources = new Map(); // userId -> DiscordPcmJitterSource\n    this.discordMembers = new Map(); // userId -> { displayName, photoURL }\n    this.discordLastAudioAt = new Map(); // userId -> last decoded PCM timestamp\n    this.discordMixLoop = null;\n    this.discordCaptureErrors = 0;`,
  'Discord member state',
);

replaceOnce(
  `    const decoder = new prism.opus.Decoder({\n      rate: SAMPLE_RATE,\n      channels: CHANNELS,\n      frameSize: SAMPLES_PER_FRAME,\n    });\n\n    const userState = { opusStream, decoder, stopped: false };\n    this.userDecoders.set(userId, userState);\n    this.discordMixSources.set(userId, new DiscordPcmJitterSource({\n      frameBytes: BYTES_PER_FRAME,\n      channels: CHANNELS,\n      profile: this.audioProfile,\n    }));`,
  `    const decoder = new prism.opus.Decoder({\n      rate: SAMPLE_RATE,\n      channels: VOICE_CHANNELS,\n      frameSize: SAMPLES_PER_FRAME,\n    });\n\n    const userState = { opusStream, decoder, stopped: false };\n    this.userDecoders.set(userId, userState);\n    this.discordMixSources.set(userId, new DiscordPcmJitterSource({\n      frameBytes: VOICE_BYTES_PER_FRAME,\n      channels: VOICE_CHANNELS,\n      profile: this.audioProfile,\n    }));\n    const fallbackMember = {\n      displayName: \`Discord \${String(userId).slice(-4)}\`,\n      photoURL: 'https://cdn.discordapp.com/embed/avatars/0.png',\n    };\n    this.discordMembers.set(userId, fallbackMember);\n    this.resolveMember(userId).then((member) => {\n      if (!this.stopped && this.userDecoders.has(userId)) this.discordMembers.set(userId, member);\n    }).catch(() => {});`,
  'mono Discord decoder',
);

replaceOnce(
  `    decoder.on('data', (pcm) => {\n      if (userState.stopped) return;\n      const src = this.discordMixSources.get(userId);\n      if (!src) return;\n      src.push(pcm);\n    });`,
  `    decoder.on('data', (pcm) => {\n      if (userState.stopped) return;\n      const src = this.discordMixSources.get(userId);\n      if (!src) return;\n      this.discordLastAudioAt.set(userId, Date.now());\n      src.push(pcm);\n    });`,
  'speaker activity tracking',
);

replaceOnce(
  `    this.userDecoders.delete(userId);\n    this.discordMixSources.delete(userId);\n    console.log(\`[VoiceBridge:\${this.roomId}] Unsubscribed Discord user \${userId}\`);`,
  `    this.userDecoders.delete(userId);\n    this.discordMixSources.delete(userId);\n    this.discordMembers.delete(userId);\n    this.discordLastAudioAt.delete(userId);\n    console.log(\`[VoiceBridge:\${this.roomId}] Unsubscribed Discord user \${userId}\`);`,
  'speaker cleanup',
);

replaceOnce(
  `    let out;\n    if (frames.length === 0) {\n      out = SILENCE_FRAME;\n    } else if (frames.length === 1) {\n      out = Buffer.from(frames[0]);\n    } else {\n      out = Buffer.alloc(BYTES_PER_FRAME);\n      for (let i = 0; i < BYTES_PER_FRAME; i += 2) {`,
  `    let out;\n    if (frames.length === 0) {\n      out = VOICE_SILENCE_FRAME;\n    } else if (frames.length === 1) {\n      out = Buffer.from(frames[0]);\n    } else {\n      out = Buffer.alloc(VOICE_BYTES_PER_FRAME);\n      for (let i = 0; i < VOICE_BYTES_PER_FRAME; i += 2) {`,
  'mono Discord mixer',
);

replaceOnce(
  `    const samples = new Int16Array(out.buffer, out.byteOffset, out.length / 2);\n    const audioFrame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);`,
  `    const samples = new Int16Array(out.buffer, out.byteOffset, out.length / 2);\n    const audioFrame = new AudioFrame(samples, SAMPLE_RATE, VOICE_CHANNELS, SAMPLES_PER_FRAME);`,
  'mono LiveKit frame',
);

replaceOnce(
  `    const stream = new AudioStream(track, SAMPLE_RATE, CHANNELS);`,
  `    const stream = new AudioStream(track, SAMPLE_RATE, VOICE_CHANNELS);`,
  'mono room listener',
);

replaceOnce(
  `      if (src.buf.length >= BYTES_PER_FRAME) {\n        frames.push(src.buf.subarray(0, BYTES_PER_FRAME));\n        src.buf = src.buf.subarray(BYTES_PER_FRAME);\n      }`,
  `      if (src.buf.length >= VOICE_BYTES_PER_FRAME) {\n        frames.push(src.buf.subarray(0, VOICE_BYTES_PER_FRAME));\n        src.buf = src.buf.subarray(VOICE_BYTES_PER_FRAME);\n      }`,
  'mono app frame reader',
);

replaceOnce(
  `      out = SILENCE_FRAME;\n    } else if (frames.length === 1) {\n      this.lastAppAudioAt = Date.now();\n      out = Buffer.from(frames[0]);\n    } else {\n      this.lastAppAudioAt = Date.now();\n      out = Buffer.alloc(BYTES_PER_FRAME);\n      for (let i = 0; i < BYTES_PER_FRAME; i += 2) {`,
  `      out = VOICE_SILENCE_FRAME;\n    } else if (frames.length === 1) {\n      this.lastAppAudioAt = Date.now();\n      out = Buffer.from(frames[0]);\n    } else {\n      this.lastAppAudioAt = Date.now();\n      out = Buffer.alloc(VOICE_BYTES_PER_FRAME);\n      for (let i = 0; i < VOICE_BYTES_PER_FRAME; i += 2) {`,
  'mono HearMeOut mixer',
);

replaceOnce(
  `    if (this.mixStream.readableLength < BYTES_PER_FRAME * 8) {\n      this.mixStream.push(out);\n    }`,
  `    if (this.mixStream.readableLength < DISCORD_BYTES_PER_FRAME * 8) {\n      this.mixStream.push(monoToDiscordStereo(out));\n    }`,
  'Discord output upmix',
);

replaceOnce(
  `  createMixStream() {\n    const stream = new Readable({\n      highWaterMark: BYTES_PER_FRAME * 32,`,
  `  createMixStream() {\n    const stream = new Readable({\n      highWaterMark: DISCORD_BYTES_PER_FRAME * 32,`,
  'Discord output stream size',
);

replaceOnce(
  `    this.mixedSource = new AudioSource(SAMPLE_RATE, CHANNELS);`,
  `    this.mixedSource = new AudioSource(SAMPLE_RATE, VOICE_CHANNELS);`,
  'mono LiveKit source',
);

replaceOnce(
  `    for (const [livekitRoomId, label] of [[this.roomId, 'voice'], [\`${this.roomId}-music\`, 'music']]) {`,
  `    // Voice bridge is speech-only. Music/video stays in Discord Activities.\n    for (const [livekitRoomId, label] of [[this.roomId, 'voice']]) {`,
  'remove music bridge lane',
);

const statusMarker = `  status() {\n    const botVoiceState = this.guild?.voiceStates?.cache?.get(this.client?.user?.id);\n    const jitterSources = Array.from(this.discordMixSources.values()).map((src) => src.snapshot());`;
const statusReplacement = `  status() {\n    const botVoiceState = this.guild?.voiceStates?.cache?.get(this.client?.user?.id);\n    const now = Date.now();\n    const discordMembers = Array.from(this.userDecoders.keys()).map((userId) => {\n      const member = this.discordMembers.get(userId) || {\n        displayName: \`Discord \${String(userId).slice(-4)}\`,\n        photoURL: 'https://cdn.discordapp.com/embed/avatars/0.png',\n      };\n      const speaking = now - Number(this.discordLastAudioAt.get(userId) || 0) <= ACTIVE_DISCORD_SPEAKER_MS;\n      return { id: userId, displayName: member.displayName, photoURL: member.photoURL, speaking };\n    });\n    const activeDiscordSpeakers = discordMembers.filter((member) => member.speaking).map((member) => member.id);\n    const jitterSources = Array.from(this.discordMixSources.values()).map((src) => src.snapshot());`;
replaceOnce(statusMarker, statusReplacement, 'member status');

replaceOnce(
  `      discordSpeakers: this.userDecoders.size,\n      appSources: this.mixSources.size,`,
  `      discordSpeakers: this.userDecoders.size,\n      discordHumanCount: discordMembers.length,\n      discordMembers,\n      activeDiscordSpeakers,\n      appSources: this.mixSources.size,`,
  'named Discord member fields',
);

replaceOnce(
  `      audioProfile: this.audioProfile,\n      discordJitter: { ...discordJitter, captureErrors: this.discordCaptureErrors },`,
  `      audioProfile: this.audioProfile,\n      voiceEncoding: {\n        sampleRate: SAMPLE_RATE,\n        channels: VOICE_CHANNELS,\n        lane: 'voice-only',\n        ttsIncluded: true,\n        musicIncluded: false,\n      },\n      discordJitter: { ...discordJitter, captureErrors: this.discordCaptureErrors },`,
  'voice encoding status',
);

const helperMarker = `function isLiveKitRateLimitError(err) {`;
const helper = `function monoToDiscordStereo(mono) {\n  if (!mono || mono.length === 0) return Buffer.alloc(0);\n  const sampleCount = Math.floor(mono.length / 2);\n  const stereo = Buffer.alloc(sampleCount * 4);\n  for (let sample = 0; sample < sampleCount; sample += 1) {\n    const value = mono.readInt16LE(sample * 2);\n    const offset = sample * 4;\n    stereo.writeInt16LE(value, offset);\n    stereo.writeInt16LE(value, offset + 2);\n  }\n  return stereo;\n}\n\nfunction isLiveKitRateLimitError(err) {`;
replaceOnce(helperMarker, helper, 'mono-to-Discord helper');

for (const marker of [
  'const VOICE_CHANNELS = 1;',
  'discordMembers = new Map()',
  'this.discordLastAudioAt.set(userId, Date.now())',
  "for (const [livekitRoomId, label] of [[this.roomId, 'voice']])",
  'discordHumanCount: discordMembers.length',
  "lane: 'voice-only'",
  'monoToDiscordStereo(out)',
]) {
  if (!source.includes(marker)) throw new Error(`Voice-only bridge patch verification failed: ${marker}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Voice bridge voice-only mono/member patch applied.');
