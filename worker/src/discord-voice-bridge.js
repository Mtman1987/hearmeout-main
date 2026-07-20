// ══════════════════════════════════════════════════════════════════════════
// Discord <-> HearMeOut voice bridge
// ──────────────────────────────────────────────────────────────────────────
// ONE LiveKit Room connection total per bridge (was one per Discord user).
//
//   Discord VC  ->  LiveKit room `${roomId}`
//     All Discord speakers are decoded and mixed into a single PCM stream,
//     published as one participant `discord-mixed`. This costs exactly 1
//     LiveKit connection regardless of how many people are in the VC.
//
//   LiveKit room `${roomId}-music` + `${roomId}`  ->  Discord VC
//     App participants are mixed and played back into Discord via the bot.
//
// Echo is avoided by never mixing our own `discord-mixed` track back.
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

    // Single publisher room — all Discord speakers mixed into one track
    this.publishRoom = null;
    this.mixedSource = null;
    this.mixedTrack = null;

    // Per-user decoder state (no Room per user — just opus decode + PCM mix)
    this.userDecoders = new Map(); // userId -> { opusStream, decoder, buf, stopped }

    // Discord mix tick — combines all user PCM buffers into one frame
    this.discordMixSources = new Map(); // userId -> { buf }
    this.discordMixTimer = null;

    // App audio -> Discord playback
    this.listeners = [];
    this.mixSources = new Map(); // identity -> { stream, buf, closed }
    this.mixStream = null;
    this.player = null;
    this.appMixTimer = null;

    this.stopped = false;
  }

  async mintToken({ roomId = this.roomId, bridgeIdentity, userName, metadata }) {
    const res = await fetch(`${this.appUrl}/api/livekit-token`, {
      method: 'POST',
      headers: { ...this.workerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, voiceBridge: true, bridgeIdentity, userName, bridgeMetadata: metadata }),
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

  // ── Discord speaker handling (no new Room per user) ──────────────────────
  handleMemberJoined(userId) {
    if (this.stopped || userId === this.client?.user?.id) return;
    if (this.userDecoders.has(userId)) return;

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
    });
    const decoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: SAMPLES_PER_FRAME,
    });

    const userState = { opusStream, decoder, stopped: false };
    this.userDecoders.set(userId, userState);
    this.discordMixSources.set(userId, { buf: Buffer.alloc(0) });

    opusStream.on('error', () => {});
    decoder.on('error', () => {});
    decoder.on('data', (pcm) => {
      if (userState.stopped) return;
      const src = this.discordMixSources.get(userId);
      if (!src) return;
      src.buf = src.buf.length ? Buffer.concat([src.buf, pcm]) : pcm;
      if (src.buf.length > MAX_SOURCE_BACKLOG) {
        src.buf = src.buf.subarray(src.buf.length - MAX_SOURCE_BACKLOG);
      }
    });
    opusStream.on('close', () => this.handleMemberLeft(userId));
    opusStream.pipe(decoder);

    console.log(`[VoiceBridge:${this.roomId}] Subscribed to Discord user ${userId}`);
  }

  handleMemberLeft(userId) {
    const state = this.userDecoders.get(userId);
    if (!state) return;
    state.stopped = true;
    try { state.opusStream.unpipe(state.decoder); } catch {}
    try { state.opusStream.destroy(); } catch {}
    try { state.decoder.destroy(); } catch {}
    this.userDecoders.delete(userId);
    this.discordMixSources.delete(userId);
    console.log(`[VoiceBridge:${this.roomId}] Unsubscribed Discord user ${userId}`);
  }

  // Mix all Discord user PCM buffers into one frame and push to LiveKit
  discordMixTick() {
    if (this.stopped || !this.mixedSource) return;

    const frames = [];
    for (const src of this.discordMixSources.values()) {
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

    const samples = new Int16Array(out.buffer, out.byteOffset, out.length / 2);
    const audioFrame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
    this.mixedSource.captureFrame(audioFrame).catch(() => {});
  }

  // ── App audio -> Discord playback ────────────────────────────────────────
  attachMixSource(sourceKey, track, identity = sourceKey) {
    if (this.stopped || !identity) return;
    if (identity.startsWith('discord-')) return; // no echo
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
      } catch {}
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

  appMixTick() {
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

    if (this.mixStream.readableLength < BYTES_PER_FRAME * 8) {
      this.mixStream.push(out);
    }
  }

  // ── Start ────────────────────────────────────────────────────────────────
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

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      this.connection.destroy();
      this.connection = null;
      throw err;
    }

    bridgesByChannel.set(this.voiceChannelId, this);
    console.log(`[VoiceBridge:${this.roomId}] Joined Discord voice channel ${this.voiceChannelId}`);

    // Connect the single publisher room and the listener rooms
    await this.startPublisher();
    await this.startListeners();

    // Wire up Discord speaker subscriptions
    this.connection.receiver.speaking.on('start', (userId) => this.handleMemberJoined(userId));
    for (const userId of this.currentMemberIds()) this.handleMemberJoined(userId);

    // Start mix timers
    this.discordMixTimer = setInterval(() => this.discordMixTick(), 20);
    this.appMixTimer = setInterval(() => this.appMixTick(), 20);
  }

  async startPublisher() {
    const token = await this.mintToken({
      bridgeIdentity: `discord-mixed-${this.roomId}`,
      userName: 'Discord VC',
      metadata: JSON.stringify({ uid: `discord-mixed-${this.roomId}`, displayName: 'Discord VC', source: 'discord' }),
    });
    this.publishRoom = new Room();
    await this.publishRoom.connect(this.livekitUrl, token);
    this.mixedSource = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.mixedTrack = LocalAudioTrack.createAudioTrack('discord-mixed', this.mixedSource);
    await this.publishRoom.localParticipant.publishTrack(
      this.mixedTrack,
      new TrackPublishOptions({ source: TrackSource.MICROPHONE }),
    );
    console.log(`[VoiceBridge:${this.roomId}] Publisher room connected — discord-mixed-${this.roomId}`);
  }

  async startListeners() {
    // App audio playback into Discord
    this.mixStream = new Readable({ read() {} });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.player.on('error', (err) => console.warn(`[VoiceBridge:${this.roomId}] player error:`, err.message));
    const resource = createAudioResource(this.mixStream, { inputType: StreamType.Raw });
    this.connection.subscribe(this.player);
    this.player.play(resource);

    for (const [livekitRoomId, label] of [[this.roomId, 'voice'], [`${this.roomId}-music`, 'music']]) {
      const token = await this.mintToken({
        roomId: livekitRoomId,
        bridgeIdentity: `discord-bridge-listener-${label}-${this.roomId}`,
        userName: 'Discord Bridge',
        metadata: JSON.stringify({ bridge: true, hidden: true, source: 'discord' }),
      });
      const listener = new Room();
      await listener.connect(this.livekitUrl, token);
      this.listeners.push(listener);

      listener.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        this.attachMixSource(`${label}:${participant.identity}`, track, participant.identity);
      });
      listener.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
        this.detachMixSource(`${label}:${participant.identity}`);
      });
      listener.on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.detachMixSource(`${label}:${participant.identity}`);
      });
      for (const participant of listener.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          if (pub.track) this.attachMixSource(`${label}:${participant.identity}`, pub.track, participant.identity);
        }
      }
      console.log(`[VoiceBridge:${this.roomId}] Listener connected for ${label} (${livekitRoomId})`);
    }
  }

  status() {
    return {
      running: true,
      roomId: this.roomId,
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      startedAt: this.startedAt,
      discordSpeakers: this.userDecoders.size,
      appSources: this.mixSources.size,
    };
  }

  async stop() {
    this.stopped = true;
    if (this.discordMixTimer) { clearInterval(this.discordMixTimer); this.discordMixTimer = null; }
    if (this.appMixTimer) { clearInterval(this.appMixTimer); this.appMixTimer = null; }
    bridgesByChannel.delete(this.voiceChannelId);

    for (const userId of Array.from(this.userDecoders.keys())) this.handleMemberLeft(userId);

    for (const identity of Array.from(this.mixSources.keys())) this.detachMixSource(identity);

    try { this.player?.stop(true); } catch {}
    try { this.mixStream?.push(null); } catch {}
    try { await this.publishRoom?.disconnect(); } catch {}
    for (const listener of this.listeners) { try { await listener.disconnect(); } catch {} }
    try { this.connection?.destroy(); } catch {}

    this.publishRoom = null;
    this.listeners = [];
    this.connection = null;
    console.log(`[VoiceBridge:${this.roomId}] Stopped`);
  }
}

// ── Public registry API ───────────────────────────────────────────────────
const bridges = new Map();

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
