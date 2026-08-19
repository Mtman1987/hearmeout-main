'use client';

import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ParticipantEvent, type RemoteParticipant } from 'livekit-client';
import { AlertTriangle, Bot, LoaderCircle, Mic, MicOff, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';

type BotVoiceTarget = {
  name: string;
  tenantId?: string;
  wakeNames: string[];
};

type MobileVoiceControlProps = {
  roomId: string;
  remoteParticipants: RemoteParticipant[];
};

function microphoneErrorMessage(error: unknown) {
  const value = error as { name?: string; message?: string } | null;
  const name = String(value?.name || '').toLowerCase();
  if (name === 'notallowederror' || name === 'securityerror' || name === 'permissiondeniederror') {
    return 'Microphone permission is blocked. In Chrome, open this site\'s permissions and allow Microphone, then tap Enable microphone again.';
  }
  if (name === 'notfounderror' || name === 'devicesnotfounderror') return 'No microphone was found on this device.';
  if (name === 'notreadableerror' || name === 'trackstarterror') return 'The microphone is busy in another app or browser tab. Close the other microphone session and try again.';
  return value?.message ? `Could not start the microphone: ${value.message}` : 'Could not start the microphone. Check this site\'s microphone permission and try again.';
}

function parseVoiceTargets(participants: RemoteParticipant[]): BotVoiceTarget[] {
  const targets: BotVoiceTarget[] = [];
  for (const participant of participants) {
    if (!participant.identity.startsWith('persona:')) continue;
    let metadata: any = {};
    try { metadata = participant.metadata ? JSON.parse(participant.metadata) : {}; } catch {}
    const identityName = participant.identity.replace(/^persona:/, '');
    const name = String(metadata.displayName || participant.name || identityName || 'Bot').trim();
    const wakeNames = Array.from(new Set([
      name,
      metadata.personaId,
      participant.name,
      identityName,
      ...(Array.isArray(metadata.wakeNames) ? metadata.wakeNames : []),
      ...(Array.isArray(metadata.aliases) ? metadata.aliases : []),
      ...(name.toLowerCase().includes('athena') ? ['Athena', 'Athena OS', 'Annie'] : []),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    targets.push({
      name,
      tenantId: String(metadata.ownerTenantId || metadata.personaId || identityName || '').trim() || undefined,
      wakeNames,
    });
  }
  return targets;
}

function findWakeTarget(transcript: string, targets: BotVoiceTarget[]) {
  const normalized = transcript.toLowerCase();
  for (const target of targets) {
    const match = target.wakeNames.find((wakeName) => {
      const escaped = wakeName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(normalized);
    });
    if (match) return target;
  }
  return null;
}

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export default function MobileVoiceControl({ roomId, remoteParticipants }: MobileVoiceControlProps) {
  const { localParticipant } = useLocalParticipant();
  const [micEnabled, setMicEnabledState] = React.useState(Boolean(localParticipant?.isMicrophoneEnabled));
  const [speaking, setSpeaking] = React.useState(Boolean(localParticipant?.isSpeaking));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [permissionGrantedOnce, setPermissionGrantedOnce] = React.useState(false);
  const [wakeListening, setWakeListening] = React.useState(false);
  const [wakeStatus, setWakeStatus] = React.useState('');
  const recognitionRef = React.useRef<any>(null);
  const shouldListenRef = React.useRef(false);
  const speakingBotRef = React.useRef(false);
  const targets = React.useMemo(() => parseVoiceTargets(remoteParticipants), [remoteParticipants]);

  React.useEffect(() => {
    if (!localParticipant) return;
    const sync = () => {
      setMicEnabledState(Boolean(localParticipant.isMicrophoneEnabled));
      setSpeaking(Boolean(localParticipant.isSpeaking));
    };
    sync();
    localParticipant.on(ParticipantEvent.IsSpeakingChanged, sync);
    localParticipant.on(ParticipantEvent.TrackMuted, sync);
    localParticipant.on(ParticipantEvent.TrackUnmuted, sync);
    localParticipant.on(ParticipantEvent.TrackPublished, sync);
    localParticipant.on(ParticipantEvent.TrackUnpublished, sync);
    const interval = window.setInterval(sync, 750);
    return () => {
      window.clearInterval(interval);
      localParticipant.off(ParticipantEvent.IsSpeakingChanged, sync);
      localParticipant.off(ParticipantEvent.TrackMuted, sync);
      localParticipant.off(ParticipantEvent.TrackUnmuted, sync);
      localParticipant.off(ParticipantEvent.TrackPublished, sync);
      localParticipant.off(ParticipantEvent.TrackUnpublished, sync);
    };
  }, [localParticipant]);

  const setMicrophone = React.useCallback(async (enabled: boolean) => {
    if (!localParticipant || pending) return;
    setPending(true);
    setError('');
    try {
      await localParticipant.setMicrophoneEnabled(enabled);
      setMicEnabledState(Boolean(localParticipant.isMicrophoneEnabled));
      if (enabled) setPermissionGrantedOnce(true);
    } catch (reason) {
      setMicEnabledState(Boolean(localParticipant.isMicrophoneEnabled));
      setError(microphoneErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }, [localParticipant, pending]);

  const speakBotReply = React.useCallback(async (payload: any) => {
    const reply = String(payload?.response || payload?.data?.response || '').trim();
    const handoff = payload?.personaSpeech;
    if (!reply && !handoff?.attempted) return;
    speakingBotRef.current = true;
    try {
      recognitionRef.current?.stop?.();
      if (handoff?.attempted && handoff?.ok === false) throw new Error(String(handoff.error || 'LiveKit persona playback failed'));
      // The server already published the canonical persona audio through
      // LiveKit. Do not play a second browser TTS voice over it. Keep browser
      // recognition paused for approximately the spoken reply duration.
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(12_000, Math.max(1_200, reply.length * 55))));
    } finally {
      speakingBotRef.current = false;
      setWakeStatus('Listening for a bot wake name…');
    }
  }, []);

  const sendVoiceCommand = React.useCallback(async (transcript: string, target: BotVoiceTarget) => {
    setWakeStatus(`Heard ${target.name}. Thinking…`);
    try {
      const response = await fetch('/api/bot/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: transcript,
          transcript,
          roomId,
          targetTenantId: target.tenantId,
          speak: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Bot returned ${response.status}`));
      await speakBotReply(payload);
    } catch (reason) {
      setWakeStatus(reason instanceof Error ? reason.message : String(reason));
    }
  }, [roomId, speakBotReply]);

  const startWakeRecognition = React.useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) {
      setWakeStatus('Wake-name listening is not supported by this browser. Chrome on Android is recommended.');
      setWakeListening(false);
      shouldListenRef.current = false;
      return;
    }
    if (!targets.length) {
      setWakeStatus('Join a bot first, then enable wake-name listening.');
      setWakeListening(false);
      shouldListenRef.current = false;
      return;
    }

    recognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => setWakeStatus(`Listening for ${targets.map((target) => target.name).join(', ')}…`);
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (!event.results[i].isFinal) continue;
        const transcript = String(event.results[i][0]?.transcript || '').trim();
        if (!transcript || speakingBotRef.current) continue;
        const target = findWakeTarget(transcript, targets);
        if (target) {
          shouldListenRef.current = true;
          void sendVoiceCommand(transcript, target);
          break;
        }
      }
    };
    recognition.onerror = (event: any) => {
      const code = String(event?.error || 'speech recognition error');
      if (code !== 'no-speech' && code !== 'aborted') setWakeStatus(`Wake listening error: ${code}`);
    };
    recognition.onend = () => {
      if (!shouldListenRef.current || speakingBotRef.current) return;
      window.setTimeout(() => {
        if (!shouldListenRef.current || speakingBotRef.current) return;
        try { recognition.start(); } catch {}
      }, 350);
    };
    try { recognition.start(); } catch {}
  }, [sendVoiceCommand, targets]);

  const toggleWakeListening = React.useCallback(() => {
    if (wakeListening) {
      shouldListenRef.current = false;
      setWakeListening(false);
      setWakeStatus('Wake-name listening is off.');
      recognitionRef.current?.abort?.();
      return;
    }
    shouldListenRef.current = true;
    setWakeListening(true);
    startWakeRecognition();
  }, [startWakeRecognition, wakeListening]);

  React.useEffect(() => () => {
    shouldListenRef.current = false;
    recognitionRef.current?.abort?.();
  }, []);

  const startTouchPtt = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!permissionGrantedOnce || pending) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void setMicrophone(true);
  }, [pending, permissionGrantedOnce, setMicrophone]);

  const stopTouchPtt = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!permissionGrantedOnce) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    void setMicrophone(false);
  }, [permissionGrantedOnce, setMicrophone]);

  if (!localParticipant) return null;

  return (
    <section className="sm:hidden col-span-1 rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm" aria-label="Mobile voice controls">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${speaking && micEnabled ? 'border-emerald-400 ring-2 ring-emerald-400/50' : micEnabled ? 'border-primary/60' : 'border-destructive/50'}`}>
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-destructive" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{speaking && micEnabled ? 'You are speaking' : micEnabled ? 'Microphone is live' : 'Microphone is off'}</p>
          <p className="text-xs text-muted-foreground">{micEnabled ? 'Your voice is being published to this room.' : 'Tap Enable microphone so the room can hear you.'}</p>
        </div>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${speaking && micEnabled ? 'bg-emerald-400 animate-pulse' : micEnabled ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <Button type="button" size="lg" variant={micEnabled ? 'outline' : 'default'} disabled={pending} onClick={() => void setMicrophone(!micEnabled)} className="h-12 w-full text-base">
          {pending ? <LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> : micEnabled ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
          {pending ? 'Starting microphone…' : micEnabled ? 'Mute microphone' : 'Enable microphone'}
        </Button>

        {permissionGrantedOnce && !micEnabled ? (
          <Button type="button" variant="secondary" className="h-12 touch-none select-none" onPointerDown={startTouchPtt} onPointerUp={stopTouchPtt} onPointerCancel={stopTouchPtt} onContextMenu={(event) => event.preventDefault()}>
            <Radio className="mr-2 h-5 w-5" /> Hold to talk
          </Button>
        ) : null}

        <Button type="button" variant={wakeListening ? 'secondary' : 'outline'} className="h-12" onClick={toggleWakeListening} disabled={!micEnabled || targets.length === 0}>
          <Bot className="mr-2 h-5 w-5" /> {wakeListening ? 'Wake listening: ON' : 'Enable bot wake listening'}
        </Button>
      </div>

      {targets.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Say {targets.map((target) => `“${target.wakeNames[0]}…”`).join(' or ')}. Normal room speech is ignored unless a joined bot wake name is present.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Join Athena or another shared bot to enable voice wake-name commands.</p>
      )}
      {wakeStatus ? <p className="mt-2 text-xs text-muted-foreground">{wakeStatus}</p> : null}

      {error ? (
        <div className="mt-3 flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}
