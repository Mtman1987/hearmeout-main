'use client';

import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ParticipantEvent } from 'livekit-client';
import { AlertTriangle, LoaderCircle, Mic, MicOff, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';

function microphoneErrorMessage(error: unknown) {
  const value = error as { name?: string; message?: string } | null;
  const name = String(value?.name || '').toLowerCase();
  if (name === 'notallowederror' || name === 'securityerror' || name === 'permissiondeniederror') {
    return 'Microphone permission is blocked. In Chrome, open this site\'s permissions and allow Microphone, then tap Enable microphone again.';
  }
  if (name === 'notfounderror' || name === 'devicesnotfounderror') {
    return 'No microphone was found on this device.';
  }
  if (name === 'notreadableerror' || name === 'trackstarterror') {
    return 'The microphone is busy in another app or browser tab. Close the other microphone session and try again.';
  }
  return value?.message ? `Could not start the microphone: ${value.message}` : 'Could not start the microphone. Check this site\'s microphone permission and try again.';
}

export default function MobileVoiceControl() {
  const { localParticipant } = useLocalParticipant();
  const [micEnabled, setMicEnabledState] = React.useState(Boolean(localParticipant?.isMicrophoneEnabled));
  const [speaking, setSpeaking] = React.useState(Boolean(localParticipant?.isSpeaking));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [permissionGrantedOnce, setPermissionGrantedOnce] = React.useState(false);

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

  const startTouchPtt = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!permissionGrantedOnce || pending) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    void setMicrophone(true);
  }, [pending, permissionGrantedOnce, setMicrophone]);

  const stopTouchPtt = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!permissionGrantedOnce) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    void setMicrophone(false);
  }, [permissionGrantedOnce, setMicrophone]);

  if (!localParticipant) return null;

  return (
    <section className="sm:hidden rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm" aria-label="Mobile voice controls">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${speaking && micEnabled ? 'border-emerald-400 ring-2 ring-emerald-400/50' : micEnabled ? 'border-primary/60' : 'border-destructive/50'}`}>
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-destructive" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{speaking && micEnabled ? 'You are speaking' : micEnabled ? 'Microphone is live' : 'Microphone is off'}</p>
          <p className="text-xs text-muted-foreground">
            {micEnabled
              ? 'After a bot joins, say its wake name — for example, “Athena, what do you think?”'
              : 'Tap Enable microphone so the room and joined voice bots can hear you.'}
          </p>
        </div>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${speaking && micEnabled ? 'bg-emerald-400 animate-pulse' : micEnabled ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <Button
          type="button"
          size="lg"
          variant={micEnabled ? 'outline' : 'default'}
          disabled={pending}
          onClick={() => void setMicrophone(!micEnabled)}
          className="h-12 w-full text-base"
        >
          {pending ? <LoaderCircle className="mr-2 h-5 w-5 animate-spin" /> : micEnabled ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
          {pending ? 'Starting microphone…' : micEnabled ? 'Mute microphone' : 'Enable microphone'}
        </Button>

        {permissionGrantedOnce && !micEnabled ? (
          <Button
            type="button"
            variant="secondary"
            className="h-12 touch-none select-none"
            onPointerDown={startTouchPtt}
            onPointerUp={stopTouchPtt}
            onPointerCancel={stopTouchPtt}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Radio className="mr-2 h-5 w-5" /> Hold to talk
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}
