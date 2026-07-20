// ══════════════════════════════════════════════════════════════════════════
// Discord <-> HearMeOut voice bridge
// ──────────────────────────────────────────────────────────────────────────
// Runs inside the DJ worker (the only place with a persistent process + the
// LiveKit rtc-node SDK + ffmpeg). For a given HearMeOut room it:
//
//   Discord VC  ->  LiveKit room `${roomId}`
//     One LiveKit participant is published per Discord speaker (identity
//     `discord-<userId>`, metadata carries their Discord name + avatar) so each
//     Discord user shows up as their own HearMeOut card and lights up when they
//     talk (LiveKit active-speaker detection drives the existing UI).
//
//   LiveKit room `${roomId}`  ->  Discord VC
//     All *app* participants are mixed into a single PCM stream and played back
//     into the Discord voice channel through the one bot voice connection.
//     (Discord only lets the single bot account transmit voice, so this side is
//     inherently a single mixed stream.)
//
// Echo is avoided by never mixing our own `discord-*` participants back into the
// Discord playback.
// ══════════════════════════════════════════════════════════════════════════

const { Readable } = require('stream');
const {
  AudioSource,
  AudioFrame,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  TrackKind,
  AudioStream,
} = require('@livekit/rtc-node');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const prism = require('prism-media');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * 20) / 1000; // 960 samples per 20ms
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2; // 3840 bytes (s16le stereo)
const SILENCE_FRAME = Buffer.alloc(BYTES_PER_FRAME);
const MAX_SOURCE_BACKLOG = BYTES_PER_FRAME * 10; // ~200ms jitter cap per source

// ── Shared Discord gateway client ─────────────────────────────────────────
let sharedClient = null;
let sharedClientReady = null;
const bridgesByChannel = new Map(); // voiceChannelId -> VoiceBridge

function getDiscordClient(token) {
  if (sharedClientReady) return sharedClientReady;
  if (!token) return Promise.reject(new Error('DISCORD_BOT_TOKEN is not configured on the worker'));

  sharedClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  sharedClient.on('voiceStateUpdate', (oldState, newState) => {
    try {
      const oldChannel = oldState.channelId;
      const newChannel = newState.channelId;
      if (oldChannel === newChannel) return;

      if (oldChannel && bridgesByChannel.has(oldChannel)) {
        bridgesByChannel.get(oldChannel).handleMemberLeft(oldState.id);
      }
      if (newChannel && bridgesByChannel.has(newChannel)) {
        bridgesByChannel.get(newChannel).handleMemberJoined(newState.id);
      }
    } catch (err) {
      console.warn('[VoiceBridge] voiceStateUpdate handler error:', err.message);
    }
  });

  sharedClient.on('error', (err) => console.error('[VoiceBridge] Discord client error:', err.message));

  sharedClientReady = sharedClient.login(token).then(() => {
    if (sharedClient.isReady()) return sharedClient;
    return new Promise((resolve) => sharedClient.once('clientReady', () => resolve(sharedClient)));
  });

  return sharedClientReady;
}

// ── Discord user -> LiveKit participant pipe ──────────────────────────────
class DiscordUserPipe {
  constructor(bridge, userId) {
    this.bridge = bridge;
    this.userId = userId;
    this.room = null;
    this.source = null;
    this.track = null;
    this.opusStream = null;
    this.decoder = null;
    this.buffer = Buffer.alloc(0);
    this.stopped = false;
  }

  async start() {
    const { displayName, photoURL } = await this.bridge.resolveMember(this.userId);
    const metadata = JSON.stringify({
      uid: `discord-${this.userId}`,
      displayName,
      photoURL,
      source: 'discord',
    });
    const token = await this.bridge.mintToken({
      bridgeIdentity: `discord-${this.userId}`,
      userName: displayName,
      metadata,
    });

    this.room = new Room();
    await this.room.connect(this.bridge.livekitUrl, token, { autoSubscribe: false });
    this.source = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.track = LocalAudioTrack.createAudioTrack(`discord-${this.userId}`, this.source);
    await this.room.localParticipant.publishTrack(
      this.track,
      new TrackPublishOptions({ source: TrackSource.MICROPHONE }),
    );

    this.opusStream = this.bridge.connection.receiver.subscribe(this.userId, {
      end: { behavior: EndBehaviorType.Manual },
    });
    this.decoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: SAMPLES_PER_FRAME,
    });
    this.opusStream.on('error', () => {});
    this.decoder.on('error', () => {});
    this.decoder.on('data', (pcm) => this.onPcm(pcm));
    this.opusStream.pipe(this.decoder);

    console.log(`[VoiceBridge:${this.bridge.roomId}] Publishing Discord user ${displayName} (${this.userId})`);
  }

  onPcm(pcm) {
    if (this.stopped || !this.source) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, pcm]) : pcm;
    while (this.buffer.length >= BYTES_PER_FRAME) {
      const chunk = Buffer.from(this.buffer.subarray(0, BYTES_PER_FRAME));
      this.buffer = this.buffer.subarray(BYTES_PER_FRAME);
      const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
      const frame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
      this.source.captureFrame(frame).catch(() => {});
    }
  }

  async stop() {
    this.stopped = true;
    try { this.opusStream?.unpipe(this.decoder); } catch {}
    try { this.opusStream?.destroy(); } catch {}
    try { this.decoder?.destroy(); } catch {}
    try { this.bridge.connection?.receiver?.subscriptions?.delete(this.userId); } catch {}
    try { await this.room?.disconnect(); } catch {}
    this.room = null;
    this.source = null;
    this.track = null;
  }
}

// ── One bridge per HearMeOut room ─────────────────────────────────────────
class VoiceBridge {
  constructor({ roomId, guildId, voiceChannelId, token, appUrl, workerHeaders, livekitUrl }) {
    this.roomId = roomId;
    this.guildId = guildId;
    this.voiceChannelId = voiceChannelId;
    this.token = token;
    this.appUrl = appUrl;
    this.workerHeaders = workerHeaders || {};
    this.livekitUrl = livekitUrl;

    this.startedAt = new Date();
    this.client = null;
    this.guild = null;
    this.connection = null;
    this.pipes = new Map(); // discord userId -> DiscordUserPipe

    this.listener = null; // First LiveKit Room listener retained for compatibility.
    this.listeners = []; // LiveKit Rooms (subscribe app audio -> Discord)
    this.mixSources = new Map(); // participant identity -> { stream, buf }
    this.mixStream = null;
    this.player = null;
    this.mixTimer = null;
    this.stopped = false;
  }

  async mintToken({ roomId = this.roomId, bridgeIdentity, userName, metadata }) {
    const res = await fetch(`${this.appUrl}/api/livekit-token`, {
      method: 'POST',
      headers: { ...this.workerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        voiceBridge: true,
        bridgeIdentity,
        userName,
        bridgeMetadata: metadata,
      }),
    });
    if (!res.ok) throw new Error(`LiveKit bridge token request failed (${res.status})`);
    const { token } = await res.json();
    if (!token) throw new Error('LiveKit bridge token missing in response');
    return token;
  }

  async resolveMember(userId) {
    const fallback = {
      displayName: `Discord ${String(userId).slice(-4)}`,
      photoURL: 'https://cdn.discordapp.com/embed/avatars/0.png',
    };
    try {
      const member = await this.guild.members.fetch(userId);
      return {
        displayName: member.displayName || member.user.username || fallback.displayName,
        photoURL: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
      };
    } catch {
      return fallback;
    }
  }

  currentMemberIds() {
    const ids = [];
    for (const vs of this.guild.voiceStates.cache.values()) {
      if (vs.channelId === this.voiceChannelId && vs.id !== this.client.user.id) ids.push(vs.id);
    }
    return ids;
  }

  handleMemberJoined(userId) {
    if (this.stopped || userId === this.client?.user?.id) return;
    if (this.pipes.has(userId)) return;
    const pipe = new DiscordUserPipe(this, userId);
    this.pipes.set(userId, pipe);
    pipe.start().catch((err) => {
      console.warn(`[VoiceBridge:${this.roomId}] Failed to start pipe for ${userId}:`, err.message);
      this.pipes.delete(userId);
    });
  }

  handleMemberLeft(userId) {
    const pipe = this.pipes.get(userId);
    if (!pipe) return;
    this.pipes.delete(userId);
    pipe.stop().catch(() => {});
  }

  async start() {
    this.client = await getDiscordClient(this.token);
    this.guild = await this.client.guilds.fetch(this.guildId);
    const channel = await this.guild.channels.fetch(this.voiceChannelId);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      throw new Error('Selected channel is not a voice channel');
    }

    this.connection = joinVoiceChannel({
      channelId: this.voiceChannelId,
      guildId: this.guildId,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    bridgesByChannel.set(this.voiceChannelId, this);
    console.log(`[VoiceBridge:${this.roomId}] Joined Discord voice channel ${this.voiceChannelId}`);

    // Fallback: create a pipe the moment someone starts speaking, even if we
    // missed their voice-state event.
    this.connection.receiver.speaking.on('start', (userId) => this.handleMemberJoined(userId));

    // Publish everyone already sitting in the channel.
    for (const userId of this.currentMemberIds()) this.handleMemberJoined(userId);

    await this.startListener();
  }

  async startListener() {
    this.mixStream = new Readable({ read() {} });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.player.on('error', (err) => console.warn(`[VoiceBridge:${this.roomId}] player error:`, err.message));
    const resource = createAudioResource(this.mixStream, { inputType: StreamType.Raw });
    this.connection.subscribe(this.player);
    this.player.play(resource);

    this.mixTimer = setInterval(() => this.mixTick(), 20);

    const rooms = Array.from(new Set([this.roomId, `${this.roomId}-music`]));
    for (const livekitRoomId of rooms) {
      const label = livekitRoomId === this.roomId ? 'voice' : 'music';
      await this.startListenerForRoom(livekitRoomId, label);
    }
  }

  async startListenerForRoom(livekitRoomId, label) {
    const token = await this.mintToken({
      roomId: livekitRoomId,
      bridgeIdentity: `discord-bridge-listener-${label}-${this.roomId}`,
      userName: 'Discord Bridge',
      metadata: JSON.stringify({ bridge: true, hidden: true, source: 'discord', bridgeRoom: livekitRoomId, bridgeLane: label }),
    });
    const listener = new Room();
    await listener.connect(this.livekitUrl, token);
    this.listeners.push(listener);
    if (!this.listener) this.listener = listener;

    listener.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      this.attachMixSource(`${label}:${participant.identity}`, track, participant.identity);
    });
    listener.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
      this.detachMixSource(`${label}:${participant.identity}`);
    });
    listener.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.detachMixSource(`${label}:${participant.identity}`);
    });

    // Pick up tracks that were already published before we connected.
    for (const participant of listener.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track) this.attachMixSource(`${label}:${participant.identity}`, pub.track, participant.identity);
      }
    }
    console.log(`[VoiceBridge:${this.roomId}] Listening for ${label} audio in LiveKit room ${livekitRoomId}`);
  }

  attachMixSource(sourceKey, track, identity = sourceKey) {
    if (this.stopped || !identity) return;
    if (identity.startsWith('discord-')) return; // never echo our own audio back
    if (!track || track.kind !== TrackKind.KIND_AUDIO) return;
    if (this.mixSources.has(sourceKey)) return;

    const stream = new AudioStream(track, SAMPLE_RATE, CHANNELS);
    const src = { stream, buf: Buffer.alloc(0), closed: false };
    this.mixSources.set(sourceKey, src);

    (async () => {
      try {
        for await (const frame of stream) {
          if (src.closed) break;
          const bytes = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
          src.buf = src.buf.length ? Buffer.concat([src.buf, bytes]) : Buffer.from(bytes);
          if (src.buf.length > MAX_SOURCE_BACKLOG) {
            src.buf = src.buf.subarray(src.buf.length - MAX_SOURCE_BACKLOG);
          }
        }
      } catch {
        // stream closed
      }
    })();
    console.log(`[VoiceBridge:${this.roomId}] Mixing app participant ${identity} into Discord`);
  }

  detachMixSource(sourceKey) {
    const src = this.mixSources.get(sourceKey);
    if (!src) return;
    src.closed = true;
    try { src.stream.close(); } catch {}
    this.mixSources.delete(sourceKey);
  }

  mixTick() {
    if (this.stopped || !this.mixStream) return;

    const frames = [];
    for (const src of this.mixSources.values()) {
      if (src.buf.length >= BYTES_PER_FRAME) {
        frames.push(src.buf.subarray(0, BYTES_PER_FRAME));
        src.buf = src.buf.subarray(BYTES_PER_FRAME);
      }
    }

    let out;
    if (frames.length === 0) {
      out = SILENCE_FRAME;
    } else if (frames.length === 1) {
      out = Buffer.from(frames[0]);
    } else {
      out = Buffer.alloc(BYTES_PER_FRAME);
      for (let i = 0; i < BYTES_PER_FRAME; i += 2) {
        let sum = 0;
        for (const frame of frames) sum += frame.readInt16LE(i);
        if (sum > 32767) sum = 32767;
        else if (sum < -32768) sum = -32768;
        out.writeInt16LE(sum, i);
      }
    }

    // Bound latency: if the player is behind, drop instead of buffering forever.
    if (this.mixStream.readableLength < BYTES_PER_FRAME * 8) {
      this.mixStream.push(out);
    }
  }

  status() {
    return {
      running: true,
      roomId: this.roomId,
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      startedAt: this.startedAt,
      discordSpeakers: this.pipes.size,
      appSources: this.mixSources.size,
    };
  }

  async stop() {
    this.stopped = true;
    if (this.mixTimer) { clearInterval(this.mixTimer); this.mixTimer = null; }
    bridgesByChannel.delete(this.voiceChannelId);

    for (const pipe of this.pipes.values()) { try { await pipe.stop(); } catch {} }
    this.pipes.clear();

    for (const identity of Array.from(this.mixSources.keys())) this.detachMixSource(identity);

    try { this.player?.stop(true); } catch {}
    try { this.mixStream?.push(null); } catch {}
    for (const listener of this.listeners) { try { await listener.disconnect(); } catch {} }
    try { this.connection?.destroy(); } catch {}
    this.listener = null;
    this.listeners = [];
    this.connection = null;
    console.log(`[VoiceBridge:${this.roomId}] Stopped`);
  }
}

// ── Public registry API ───────────────────────────────────────────────────
const bridges = new Map(); // roomId -> VoiceBridge

async function startVoiceBridge(opts) {
  const existing = bridges.get(opts.roomId);
  if (existing) {
    if (existing.voiceChannelId === opts.voiceChannelId && existing.guildId === opts.guildId) {
      return { success: true, message: 'Bridge already running', status: existing.status() };
    }
    await existing.stop();
    bridges.delete(opts.roomId);
  }

  const bridge = new VoiceBridge(opts);
  try {
    await bridge.start();
  } catch (err) {
    try { await bridge.stop(); } catch {}
    throw err;
  }
  bridges.set(opts.roomId, bridge);
  return { success: true, message: 'Bridge started', status: bridge.status() };
}

async function stopVoiceBridge(roomId) {
  const bridge = bridges.get(roomId);
  if (!bridge) return { success: true, message: 'No bridge running' };
  await bridge.stop();
  bridges.delete(roomId);
  return { success: true, message: 'Bridge stopped' };
}

function getVoiceBridgeStatus(roomId) {
  const bridge = bridges.get(roomId);
  if (!bridge) return { running: false };
  return bridge.status();
}

function listVoiceBridges() {
  return Array.from(bridges.values()).map((bridge) => bridge.status());
}

module.exports = {
  startVoiceBridge,
  stopVoiceBridge,
  getVoiceBridgeStatus,
  listVoiceBridges,
};
