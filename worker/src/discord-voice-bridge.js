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
  AudioPlayerStatus,
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
const APP_SILENCE_TAIL_MS = 1200;
const SILENCE_HEARTBEAT_MS = 250;
const LIVEKIT_RECONNECT_BASE_MS = 1500;
const LIVEKIT_RECONNECT_MAX_MS = 20000;
const LIVEKIT_CONNECT_MAX_ATTEMPTS = 5;
const LIVEKIT_RATE_LIMIT_BASE_MS = 2000;
const DISCORD_JOIN_COOLDOWN_MS = 60_000;

function isLiveKitRateLimitError(err) {
  const message = String(err?.message || err || '');
  return /\b429\b|too many requests|rate[ -]?limit/i.test(message);
}

async function connectLiveKitRoom(room, url, token, label) {
  for (let attempt = 1; attempt <= LIVEKIT_CONNECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await room.connect(url, token);
      return;
    } catch (err) {
      if (!isLiveKitRateLimitError(err) || attempt === LIVEKIT_CONNECT_MAX_ATTEMPTS) throw err;

      const delayMs = LIVEKIT_RATE_LIMIT_BASE_MS * (2 ** (attempt - 1));
      console.warn(
        `[VoiceBridge] LiveKit rate-limited ${label} connection ` +
        `(attempt ${attempt}/${LIVEKIT_CONNECT_MAX_ATTEMPTS}); retrying in ${delayMs}ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ── Shared Discord gateway client ─────────────────────────────────────────
let sharedClient = null;
let sharedClientReady = null;
const bridgesByChannel = new Map(); // voiceChannelId -> VoiceBridge
const bridgeStartInFlight = new Map(); // roomId -> Promise
const bridgeStartCooldowns = new Map(); // roomId -> { until: number; reason: string }

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
      const botUserId = sharedClient?.user?.id;

      // If the bot itself is moved/kicked/disconnected, stop the affected bridge.
      if (botUserId && (oldState.id === botUserId || newState.id === botUserId)) {
        const tracked =
          (oldChannel && bridgesByChannel.has(oldChannel) && oldChannel) ||
          (newChannel && bridgesByChannel.has(newChannel) && newChannel) ||
          null;
        if (tracked) {
          bridgesByChannel.get(tracked).handleBotVoiceStateChange(newChannel);
        }
      }

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
    this.listenerSpecs = [];
    this.mixSources = new Map(); // identity -> { stream, buf, closed }
    this.mixStream = null;
    this.player = null;
    this.playerResource = null;
    this.appMixTimer = null;
    this.rebuildingPlayback = false;
    this.lastAppAudioAt = 0;
    this.lastSilenceAt = 0;

    this.publishReconnectTimer = null;
    this.publishReconnectAttempts = 0;

    this.stopped = false;
  }

  markStopCooldown(reason) {
    const normalizedReason = String(reason || 'stopped');
    bridgeStartCooldowns.set(this.roomId, {
      until: Date.now() + DISCORD_JOIN_COOLDOWN_MS,
      reason: normalizedReason,
    });
    setTimeout(() => {
      const current = bridgeStartCooldowns.get(this.roomId);
      if (current && current.reason === normalizedReason && current.until <= Date.now()) {
        bridgeStartCooldowns.delete(this.roomId);
      }
    }, DISCORD_JOIN_COOLDOWN_MS + 50);
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

  handleBotVoiceStateChange(newChannelId) {
    if (this.stopped) return;
    if (newChannelId === this.voiceChannelId) return;
    this.shutdownBridge(`Bot left configured voice channel (${this.voiceChannelId})`);
  }

  async shutdownBridge(reason) {
    if (this.stopped) return;
    console.warn(`[VoiceBridge:${this.roomId}] ${reason}. Stopping bridge.`);
    this.markStopCooldown(reason);
    await this.stop();
    bridges.delete(this.roomId);
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
      const now = Date.now();
      const hasAnySource = this.mixSources.size > 0;
      const withinTail = hasAnySource && now - this.lastAppAudioAt < APP_SILENCE_TAIL_MS;
      const canHeartbeat = now - this.lastSilenceAt >= SILENCE_HEARTBEAT_MS;
      if (!withinTail || !canHeartbeat) return;
      this.lastSilenceAt = now;
      out = SILENCE_FRAME;
    } else if (frames.length === 1) {
      this.lastAppAudioAt = Date.now();
      out = Buffer.from(frames[0]);
    } else {
      this.lastAppAudioAt = Date.now();
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

  createMixStream() {
    const stream = new Readable({
      highWaterMark: BYTES_PER_FRAME * 32,
      read() {},
    });
    stream.on('error', (err) => {
      if (this.stopped) return;
      console.warn(`[VoiceBridge:${this.roomId}] mix stream error: ${err?.message || err}`);
      this.schedulePlaybackRepair('mix-stream-error');
    });
    stream.on('end', () => {
      if (this.stopped) return;
      this.schedulePlaybackRepair('mix-stream-ended');
    });
    stream.on('close', () => {
      if (this.stopped) return;
      this.schedulePlaybackRepair('mix-stream-closed');
    });
    return stream;
  }

  schedulePlaybackRepair(reason) {
    if (this.stopped) return;
    setTimeout(() => {
      if (this.stopped) return;
      this.startOrRepairPlayback(reason).catch((err) => {
        console.warn(`[VoiceBridge:${this.roomId}] playback repair failed (${reason}):`, err?.message || err);
      });
    }, 100);
  }

  async startOrRepairPlayback(reason = 'startup') {
    if (this.stopped || !this.connection) return;
    if (this.rebuildingPlayback) return;
    this.rebuildingPlayback = true;
    try {
      const previousStream = this.mixStream;
      this.mixStream = this.createMixStream();

      if (!this.player) {
        this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
        this.player.on('error', (err) => {
          if (this.stopped) return;
          console.warn(`[VoiceBridge:${this.roomId}] player error:`, err.message);
          this.schedulePlaybackRepair('player-error');
        });
        this.player.on('stateChange', (_oldState, newState) => {
          if (this.stopped) return;
          if (newState.status === AudioPlayerStatus.Idle) {
            this.schedulePlaybackRepair('player-idle');
          }
        });
        this.connection.subscribe(this.player);
      } else {
        try { this.player.stop(true); } catch {}
      }

      this.playerResource = createAudioResource(this.mixStream, { inputType: StreamType.Raw });
      this.player.play(this.playerResource);

      this.lastAppAudioAt = Date.now();
      this.lastSilenceAt = 0;

      if (previousStream) {
        try { previousStream.push(null); } catch {}
      }

      console.log(`[VoiceBridge:${this.roomId}] Playback pipeline ${reason === 'startup' ? 'started' : `repaired (${reason})`}`);
    } finally {
      this.rebuildingPlayback = false;
    }
  }

  schedulePublisherReconnect(reason) {
    if (this.stopped || this.publishReconnectTimer) return;
    const delayMs = Math.min(
      LIVEKIT_RECONNECT_BASE_MS * (2 ** this.publishReconnectAttempts),
      LIVEKIT_RECONNECT_MAX_MS,
    );
    this.publishReconnectAttempts += 1;
    console.warn(`[VoiceBridge:${this.roomId}] Publisher disconnected (${reason || 'unknown'}). Reconnecting in ${delayMs}ms.`);

    this.publishReconnectTimer = setTimeout(async () => {
      this.publishReconnectTimer = null;
      if (this.stopped) return;
      try {
        await this.startPublisher();
        this.publishReconnectAttempts = 0;
      } catch (err) {
        console.warn(`[VoiceBridge:${this.roomId}] Publisher reconnect failed:`, err?.message || err);
        this.schedulePublisherReconnect('retry-failed');
      }
    }, delayMs);
  }

  detachSourcesForLabel(label) {
    const prefix = `${label}:`;
    for (const key of Array.from(this.mixSources.keys())) {
      if (key.startsWith(prefix)) this.detachMixSource(key);
    }
  }

  scheduleListenerReconnect(spec, reason) {
    if (this.stopped || spec.reconnectTimer) return;
    spec.reconnectAttempts = (spec.reconnectAttempts || 0) + 1;
    const delayMs = Math.min(
      LIVEKIT_RECONNECT_BASE_MS * (2 ** Math.max(0, spec.reconnectAttempts - 1)),
      LIVEKIT_RECONNECT_MAX_MS,
    );
    console.warn(`[VoiceBridge:${this.roomId}] ${spec.label} listener disconnected (${reason || 'unknown'}). Reconnecting in ${delayMs}ms.`);
    this.detachSourcesForLabel(spec.label);

    spec.reconnectTimer = setTimeout(async () => {
      spec.reconnectTimer = null;
      if (this.stopped) return;
      try {
        await this.connectListener(spec);
        spec.reconnectAttempts = 0;
      } catch (err) {
        console.warn(`[VoiceBridge:${this.roomId}] ${spec.label} listener reconnect failed:`, err?.message || err);
        this.scheduleListenerReconnect(spec, 'retry-failed');
      }
    }, delayMs);
  }

  async connectListener(spec) {
    if (spec.room) {
      try { await spec.room.disconnect(); } catch {}
      spec.room = null;
    }

    const token = await this.mintToken({
      roomId: spec.livekitRoomId,
      bridgeIdentity: `discord-bridge-listener-${spec.label}-${this.roomId}`,
      userName: 'Discord Bridge',
      metadata: JSON.stringify({ bridge: true, hidden: true, source: 'discord' }),
    });

    const listener = new Room();
    listener.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      this.attachMixSource(`${spec.label}:${participant.identity}`, track, participant.identity);
    });
    listener.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
      this.detachMixSource(`${spec.label}:${participant.identity}`);
    });
    listener.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.detachMixSource(`${spec.label}:${participant.identity}`);
    });
    listener.on(RoomEvent.Disconnected, (reason) => {
      if (this.stopped) return;
      this.scheduleListenerReconnect(spec, String(reason || 'disconnected'));
    });

    await connectLiveKitRoom(listener, this.livekitUrl, token, `${this.roomId}/${spec.label}`);
    spec.room = listener;

    for (const participant of listener.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track) this.attachMixSource(`${spec.label}:${participant.identity}`, pub.track, participant.identity);
      }
    }

    console.log(`[VoiceBridge:${this.roomId}] Listener connected for ${spec.label} (${spec.livekitRoomId})`);
  }

  // ── Start ────────────────────────────────────────────────────────────────
  async start() {
    const cooldown = bridgeStartCooldowns.get(this.roomId);
    if (cooldown && cooldown.until > Date.now()) {
      throw new Error(`Bridge recently stopped; waiting ${Math.ceil((cooldown.until - Date.now()) / 1000)}s before retrying.`);
    }

    this.client = await getDiscordClient(this.token);
    this.guild = await this.client.guilds.fetch(this.guildId);
    const channel = await this.guild.channels.fetch(this.voiceChannelId);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      throw new Error('Selected channel is not a voice channel');
    }

    // Bring the LiveKit side up first so a transient WS/rate-limit failure does
    // not cause a visible join-then-immediate-leave cycle in Discord.
    await this.startPublisher();
    await this.startListeners();

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

    await this.startOrRepairPlayback('post-discord-join');

    this.connection.on('stateChange', async (_oldState, newState) => {
      if (this.stopped) return;
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        await this.shutdownBridge('Discord voice connection destroyed');
        return;
      }
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        try {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
          ]);
        } catch {
          await this.shutdownBridge('Discord voice connection disconnected');
        }
      }
    });

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
    if (this.publishRoom) {
      try { await this.publishRoom.disconnect(); } catch {}
    }

    this.publishRoom = new Room();
    this.publishRoom.on(RoomEvent.Disconnected, (reason) => {
      if (this.stopped) return;
      this.schedulePublisherReconnect(String(reason || 'disconnected'));
    });

    await connectLiveKitRoom(this.publishRoom, this.livekitUrl, token, `${this.roomId}/publisher`);
    this.mixedSource = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.mixedTrack = LocalAudioTrack.createAudioTrack('discord-mixed', this.mixedSource);
    await this.publishRoom.localParticipant.publishTrack(
      this.mixedTrack,
      new TrackPublishOptions({ source: TrackSource.MICROPHONE }),
    );
    this.publishReconnectAttempts = 0;
    console.log(`[VoiceBridge:${this.roomId}] Publisher room connected — discord-mixed-${this.roomId}`);
  }

  async startListeners() {
    await this.startOrRepairPlayback('startup');

    for (const [livekitRoomId, label] of [[this.roomId, 'voice'], [`${this.roomId}-music`, 'music']]) {
      const spec = {
        label,
        livekitRoomId,
        room: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
      };
      this.listenerSpecs.push(spec);
      await this.connectListener(spec);
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
    if (this.publishReconnectTimer) { clearTimeout(this.publishReconnectTimer); this.publishReconnectTimer = null; }
    bridgesByChannel.delete(this.voiceChannelId);

    for (const userId of Array.from(this.userDecoders.keys())) this.handleMemberLeft(userId);

    for (const identity of Array.from(this.mixSources.keys())) this.detachMixSource(identity);

    for (const spec of this.listenerSpecs) {
      if (spec.reconnectTimer) {
        clearTimeout(spec.reconnectTimer);
        spec.reconnectTimer = null;
      }
    }

    try { this.player?.stop(true); } catch {}
    try { this.mixStream?.push(null); } catch {}
    try { await this.publishRoom?.disconnect(); } catch {}
    for (const spec of this.listenerSpecs) { try { await spec.room?.disconnect(); } catch {} }
    try { this.connection?.destroy(); } catch {}

    this.publishRoom = null;
    this.listenerSpecs = [];
    this.connection = null;
    console.log(`[VoiceBridge:${this.roomId}] Stopped`);
  }
}

// ── Public registry API ───────────────────────────────────────────────────
const bridges = new Map();

async function startVoiceBridge(opts) {
  const existingPromise = bridgeStartInFlight.get(opts.roomId);
  if (existingPromise) return existingPromise;

  const cooldown = bridgeStartCooldowns.get(opts.roomId);
  if (cooldown && cooldown.until > Date.now()) {
    return {
      success: false,
      message: `Bridge recently stopped after a failed join; wait ${Math.ceil((cooldown.until - Date.now()) / 1000)}s before retrying.`,
      status: { running: false, cooldownUntil: new Date(cooldown.until).toISOString(), lastStopReason: cooldown.reason },
    };
  }

  const startPromise = (async () => {
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
    bridge.markStopCooldown(err?.message || 'bridge start failed');
    try { await bridge.stop(); } catch {}
    throw err;
  }
  bridges.set(opts.roomId, bridge);
  return { success: true, message: 'Bridge started', status: bridge.status() };
  })();

  bridgeStartInFlight.set(opts.roomId, startPromise);
  try {
    return await startPromise;
  } finally {
    bridgeStartInFlight.delete(opts.roomId);
  }
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
