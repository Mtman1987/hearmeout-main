const {
  AudioSource,
  AudioFrame,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} = require('@livekit/rtc-node');

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const SAMPLES_PER_FRAME = 960; // 20ms at 48kHz

/**
 * Reusable StreamWeaver persona transport.
 *
 * This module intentionally does not know how AthenaOS thinks, transcribes,
 * researches, or synthesizes speech. It owns only the HearMeOut transport:
 * join/leave, participant metadata, incoming room PCM, and outgoing persona PCM.
 * The AthenaOS adapter can subscribe to `audioFrame` and call `pushPcm()` with
 * synthesized mono signed-16-bit 48kHz PCM.
 */
class PersonaSession {
  constructor({ roomId, personaId, displayName, avatar, livekitUrl, token, research = true }) {
    this.roomId = roomId;
    this.personaId = personaId;
    this.displayName = displayName || personaId;
    this.avatar = avatar || '';
    this.livekitUrl = livekitUrl;
    this.token = token;
    this.research = !!research;
    this.room = null;
    this.source = null;
    this.track = null;
    this.listeners = new Set();
    this.streams = new Map();
  }

  onAudioFrame(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    if (this.room) return;
    const room = new Room();
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (!track || track.kind !== TrackKind.KIND_AUDIO) return;
      if (participant.identity === `persona:${this.personaId}`) return;
      this.consumeTrack(track, participant.identity);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, _publication, participant) => {
      this.closeStream(participant.identity);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.closeStream(participant.identity);
    });

    await room.connect(this.livekitUrl, this.token);

    this.source = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.track = LocalAudioTrack.createAudioTrack(`persona-${this.personaId}`, this.source);
    await room.localParticipant.publishTrack(
      this.track,
      new TrackPublishOptions({ source: TrackSource.MICROPHONE }),
    );

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track && publication.track.kind === TrackKind.KIND_AUDIO) {
          this.consumeTrack(publication.track, participant.identity);
        }
      }
    }
  }

  consumeTrack(track, identity) {
    const key = `${identity}:${track.sid || track.name || 'audio'}`;
    if (this.streams.has(key)) return;
    const stream = new AudioStream(track, SAMPLE_RATE, CHANNELS);
    this.streams.set(key, stream);

    (async () => {
      try {
        for await (const frame of stream) {
          const payload = {
            identity,
            sampleRate: SAMPLE_RATE,
            channels: CHANNELS,
            samplesPerChannel: frame.samplesPerChannel,
            pcm: Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength),
          };
          for (const listener of this.listeners) {
            try { listener(payload); } catch {}
          }
        }
      } catch (err) {
        console.warn(`[Persona:${this.personaId}] audio stream ended for ${identity}:`, err?.message || err);
      } finally {
        this.streams.delete(key);
      }
    })();
  }

  closeStream(identity) {
    for (const [key, stream] of this.streams.entries()) {
      if (!key.startsWith(`${identity}:`)) continue;
      try { stream.close(); } catch {}
      this.streams.delete(key);
    }
  }

  async pushPcm(pcm) {
    if (!this.source) throw new Error('Persona session is not connected');
    const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    const bytesPerFrame = SAMPLES_PER_FRAME * CHANNELS * 2;
    for (let offset = 0; offset + bytesPerFrame <= buffer.length; offset += bytesPerFrame) {
      const slice = buffer.subarray(offset, offset + bytesPerFrame);
      const samples = new Int16Array(slice.buffer, slice.byteOffset, slice.byteLength / 2);
      const frame = new AudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
      await this.source.captureFrame(frame);
    }
  }

  async stop() {
    for (const stream of this.streams.values()) {
      try { stream.close(); } catch {}
    }
    this.streams.clear();
    this.listeners.clear();
    if (this.room) {
      try { await this.room.disconnect(); } catch {}
    }
    this.room = null;
    this.source = null;
    this.track = null;
  }
}

module.exports = {
  PersonaSession,
  PERSONA_AUDIO_FORMAT: {
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    samplesPerFrame: SAMPLES_PER_FRAME,
    encoding: 's16le',
  },
};
