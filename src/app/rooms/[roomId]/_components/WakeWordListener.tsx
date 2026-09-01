'use client';

import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ParticipantEvent, Track, type RemoteParticipant } from 'livekit-client';
import { useSession } from '@/hooks/use-session';
import { isPersonaParticipant, parsePersonaMetadata } from './PersonaCard';
import { resolveBotInvocation, type RoomBotDescriptor } from '@/lib/room-persona-routing';
import {
  postRoomChatMessage,
  sendRoomPersonaCommand,
  transcribeRoomPersonaAudio,
} from '@/lib/room-persona-client';

const ANALYSE_EVERY_MS = 50;
const MIN_START_RMS = 0.006;
const MIN_CONTINUE_RMS = 0.0035;
const NOISE_START_MULTIPLIER = 3;
const NOISE_CONTINUE_MULTIPLIER = 1.7;
const SILENCE_TO_SEND_MS = 700;
const MIN_SPEECH_MS = 220;
const MAX_UTTERANCE_MS = 12_000;
const IDLE_RECORDER_RESET_MS = 2_500;
const MIN_BLOB_BYTES = 900;
const SELF_ECHO_MIN_MS = 1_500;
const SELF_ECHO_MAX_MS = 12_000;

function chooseMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function descriptorForPersona(participant: RemoteParticipant): RoomBotDescriptor | null {
  if (!isPersonaParticipant(participant)) return null;
  const metadata = parsePersonaMetadata(participant.metadata) || {};
  const identityName = participant.identity.replace(/^persona:/, '');
  const displayName = String(metadata.displayName || participant.name || identityName || 'StreamWeaver Bot').trim();
  const wakeNames = Array.from(new Set([
    displayName,
    metadata.personaId,
    participant.name,
    identityName,
    ...(metadata.wakeNames || []),
    ...(metadata.aliases || []),
    ...(metadata.previousNames || []),
    ...(displayName.toLowerCase().includes('athena') ? ['Athena', 'Athena OS', 'Annie'] : []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const targetTenantId = String(metadata.ownerTenantId || metadata.personaId || identityName || '').trim();
  if (!targetTenantId || !wakeNames.length) return null;
  return { displayName, wakeNames, targetTenantId };
}

function currentMicMediaTrack(localParticipant: any): MediaStreamTrack | null {
  const publication = localParticipant?.getTrackPublication?.(Track.Source.Microphone) as any;
  const mediaTrack = publication?.audioTrack?.mediaStreamTrack
    || publication?.track?.mediaStreamTrack
    || null;
  return mediaTrack && mediaTrack.readyState === 'live' && typeof mediaTrack.clone === 'function'
    ? mediaTrack as MediaStreamTrack
    : null;
}

function analyserRms(analyser: AnalyserNode, samples: Float32Array) {
  analyser.getFloatTimeDomainData(samples);
  let squares = 0;
  for (let i = 0; i < samples.length; i += 1) squares += samples[i] * samples[i];
  return Math.sqrt(squares / Math.max(1, samples.length));
}

function chatMessage(username: string, text: string, prefix = 'wake') {
  return {
    id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    username,
    text,
    timestamp: new Date().toISOString(),
  };
}

export default function WakeWordListener({ roomId, remoteParticipants }: { roomId: string; remoteParticipants: RemoteParticipant[] }) {
  const { localParticipant } = useLocalParticipant();
  const { user } = useSession();
  const [micRevision, setMicRevision] = React.useState(0);
  const commandInFlightRef = React.useRef(false);
  const suppressUntilRef = React.useRef(0);
  const lastTranscriptRef = React.useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const processingQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const targets = React.useMemo(
    () => remoteParticipants.map(descriptorForPersona).filter(Boolean) as RoomBotDescriptor[],
    [remoteParticipants],
  );
  const targetSignature = React.useMemo(
    () => targets.map((target) => `${target.targetTenantId}:${target.wakeNames.join('|')}`).join('::'),
    [targets],
  );
  const humanName = String(user?.displayName || (user as any)?.username || 'HearMeOut User').trim();

  React.useEffect(() => {
    if (!localParticipant) return;
    const bump = () => setMicRevision((value) => value + 1);
    localParticipant.on(ParticipantEvent.TrackPublished, bump);
    localParticipant.on(ParticipantEvent.TrackUnpublished, bump);
    localParticipant.on(ParticipantEvent.TrackMuted, bump);
    localParticipant.on(ParticipantEvent.TrackUnmuted, bump);
    return () => {
      localParticipant.off(ParticipantEvent.TrackPublished, bump);
      localParticipant.off(ParticipantEvent.TrackUnpublished, bump);
      localParticipant.off(ParticipantEvent.TrackMuted, bump);
      localParticipant.off(ParticipantEvent.TrackUnmuted, bump);
    };
  }, [localParticipant]);

  React.useEffect(() => {
    if (!localParticipant || !localParticipant.isMicrophoneEnabled || targets.length === 0) return;
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[WakeWord] MediaRecorder is unavailable in this browser.');
      return;
    }
    const sourceTrack = currentMicMediaTrack(localParticipant);
    if (!sourceTrack) return;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) {
      console.warn('[WakeWord] Web Audio is unavailable in this browser.');
      return;
    }

    let disposed = false;
    let recorder: MediaRecorder | null = null;
    let recorderStartedAt = 0;
    let speechActive = false;
    let speechStartedAt = 0;
    let lastSpeechAt = 0;
    let noiseFloor = 0.004;
    const mimeType = chooseMimeType();
    const clonedTrack = sourceTrack.clone();
    const stream = new MediaStream([clonedTrack]);
    const audioContext: AudioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.15;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    void audioContext.resume().catch(() => {});

    const processBlob = async (blob: Blob) => {
      if (disposed || blob.size < MIN_BLOB_BYTES) return;
      let transcript = '';
      try {
        transcript = await transcribeRoomPersonaAudio(blob);
      } catch (error) {
        console.warn('[WakeWord] STT failed:', error);
        return;
      }
      if (!transcript || disposed) return;
      const invocation = resolveBotInvocation(transcript, targets);
      if (!invocation?.targetTenantId) return;

      const normalized = transcript.toLowerCase();
      const recent = lastTranscriptRef.current;
      if (recent.text === normalized && Date.now() - recent.at < 3_000) return;
      lastTranscriptRef.current = { text: normalized, at: Date.now() };
      if (commandInFlightRef.current) return;
      commandInFlightRef.current = true;
      suppressUntilRef.current = Date.now() + SELF_ECHO_MIN_MS;

      const humanMessage = chatMessage(humanName, transcript, 'wake_user');
      try {
        await postRoomChatMessage(humanMessage);
      } catch (error) {
        console.warn('[WakeWord] transcript could not be mirrored into room chat:', error);
      }

      try {
        const result = await sendRoomPersonaCommand({
          roomId,
          transcript,
          targetTenantId: invocation.targetTenantId,
          fallbackDisplayName: invocation.displayName,
        });
        const replyDuration = Math.min(
          SELF_ECHO_MAX_MS,
          Math.max(SELF_ECHO_MIN_MS, result.reply.length * 55),
        );
        suppressUntilRef.current = Date.now() + replyDuration;
        if (result.reply) {
          await postRoomChatMessage(chatMessage(result.botName, result.reply, 'wake_bot')).catch((error) => {
            console.warn('[WakeWord] bot reply could not be mirrored into room chat:', error);
          });
        }
        if (result.speechError) {
          await postRoomChatMessage(chatMessage('Bots', `${result.botName} replied in text, but voice playback failed: ${result.speechError}`, 'wake_error')).catch(() => {});
        }
      } catch (error) {
        suppressUntilRef.current = Date.now() + SELF_ECHO_MIN_MS;
        await postRoomChatMessage(chatMessage('Bots', `${invocation.displayName} could not respond: ${error instanceof Error ? error.message : String(error)}`, 'wake_error')).catch(() => {});
      } finally {
        commandInFlightRef.current = false;
      }
    };

    const resetSpeechState = () => {
      speechActive = false;
      speechStartedAt = 0;
      lastSpeechAt = 0;
    };

    const startRecorder = () => {
      if (disposed || recorder || clonedTrack.readyState !== 'live') return;
      const chunks: Blob[] = [];
      const nextRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder = nextRecorder;
      recorderStartedAt = Date.now();
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      nextRecorder.onstop = () => {
        const shouldProcess = Boolean((nextRecorder as any).__hmoProcess);
        const speechMs = Number((nextRecorder as any).__hmoSpeechMs || 0);
        const blob = shouldProcess && speechMs >= MIN_SPEECH_MS
          ? new Blob(chunks, { type: nextRecorder.mimeType || mimeType || 'audio/webm' })
          : null;
        if (recorder === nextRecorder) recorder = null;
        resetSpeechState();
        if (!disposed) startRecorder();
        if (blob) {
          processingQueueRef.current = processingQueueRef.current
            .then(() => processBlob(blob))
            .catch((error) => console.warn('[WakeWord] utterance processing failed:', error));
        }
      };
      nextRecorder.start(250);
    };

    const stopRecorder = (process: boolean, speechMs = 0) => {
      const active = recorder;
      if (!active || active.state === 'inactive') return;
      (active as any).__hmoProcess = process;
      (active as any).__hmoSpeechMs = speechMs;
      recorder = null;
      try { active.stop(); } catch {}
    };

    startRecorder();
    const interval = window.setInterval(() => {
      if (disposed) return;
      const now = Date.now();
      const suppressed = commandInFlightRef.current || now < suppressUntilRef.current;
      const rms = analyserRms(analyser, samples);
      const startThreshold = Math.max(MIN_START_RMS, Math.min(0.06, noiseFloor * NOISE_START_MULTIPLIER));
      const continueThreshold = Math.max(
        MIN_CONTINUE_RMS,
        Math.min(startThreshold * 0.8, noiseFloor * NOISE_CONTINUE_MULTIPLIER),
      );

      if (suppressed) {
        if (speechActive) resetSpeechState();
        if (recorder && now - recorderStartedAt >= IDLE_RECORDER_RESET_MS) stopRecorder(false);
        return;
      }

      if (!speechActive) {
        if (rms >= startThreshold) {
          speechActive = true;
          speechStartedAt = now;
          lastSpeechAt = now;
          return;
        }
        // Learn the actual room/microphone floor only while no speech is active.
        // This keeps quiet mics sensitive without letting a noisy room constantly
        // trigger STT.
        noiseFloor = Math.max(0.0005, Math.min(0.03, noiseFloor * 0.96 + rms * 0.04));
        if (recorder && now - recorderStartedAt >= IDLE_RECORDER_RESET_MS) stopRecorder(false);
        return;
      }

      if (rms >= continueThreshold) lastSpeechAt = now;
      const speechMs = now - speechStartedAt;
      if (now - lastSpeechAt >= SILENCE_TO_SEND_MS || speechMs >= MAX_UTTERANCE_MS) {
        stopRecorder(true, speechMs);
      }
    }, ANALYSE_EVERY_MS);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      stopRecorder(false);
      try { source.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      clonedTrack.stop();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
    };
  // targetSignature is the stable dependency for target metadata; the captured
  // targets array is rebuilt only when that signature changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localParticipant, micRevision, roomId, targetSignature, humanName]);

  return null;
}
