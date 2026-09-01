'use client';

import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ParticipantEvent, type RemoteParticipant } from 'livekit-client';
import { AlertTriangle, Bot, LoaderCircle, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

type BotVoiceTarget = {
  name: string;
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
    targets.push({ name, wakeNames });
  }
  return targets;
}

export default function MobileVoiceControl({ roomId, remoteParticipants }: MobileVoiceControlProps) {
  const { localParticipant } = useLocalParticipant();
  const [micEnabled, setMicEnabledState] = React.useState(Boolean(localParticipant?.isMicrophoneEnabled));
  const [speaking, setSpeaking] = React.useState(Boolean(localParticipant?.isSpeaking));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
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
    } catch (reason) {
      setMicEnabledState(Boolean(localParticipant.isMicrophoneEnabled));
      setError(microphoneErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }, [localParticipant, pending]);

  if (!localParticipant) return null;

  const primaryWakeNames = targets.map((target) => target.wakeNames[0] || target.name).filter(Boolean);

  return (
    <section className="sm:hidden col-span-1 rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm" aria-label="Mobile voice controls" data-room-id={roomId}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${speaking && micEnabled ? 'border-emerald-400 ring-2 ring-emerald-400/50' : micEnabled ? 'border-primary/60' : 'border-destructive/50'}`}>
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-destructive" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{speaking && micEnabled ? 'You are speaking' : micEnabled ? 'Microphone is live' : 'Microphone is off'}</p>
          <p className="text-xs text-muted-foreground">{micEnabled ? 'Your LiveKit microphone is feeding the room and joined persona wake-word listener.' : 'Enable the microphone once to use room voice and AI wake names.'}</p>
        </div>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${speaking && micEnabled ? 'bg-emerald-400 animate-pulse' : micEnabled ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <Button type="button" size="lg" variant={micEnabled ? 'outline' : 'default'} disabled={pending} onClick={() => void setMicrophone(!micEnabled)} className="h-12 w-full text-base">
          {pending ? <LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> : micEnabled ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
          {pending ? 'Starting microphone…' : micEnabled ? 'Mute microphone' : 'Enable microphone'}
        </Button>
      </div>

      {targets.length > 0 ? (
        <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground"><Bot className="h-4 w-4" /> Wake-name listening is automatic</p>
          <p className="mt-1">Say {primaryWakeNames.map((name) => `“${name}, …”`).join(' or ')} while your mic is live. Normal room speech is ignored by the AI.</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Join Athena or another shared persona first. Once joined, its wake name works automatically while your mic is live.</p>
      )}

      {error ? (
        <div className="mt-3 flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}
