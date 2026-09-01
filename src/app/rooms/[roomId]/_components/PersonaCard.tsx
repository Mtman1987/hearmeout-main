'use client';

import React from 'react';
import type { Participant, RemoteParticipant } from 'livekit-client';
import { Bot, LoaderCircle, Mic, MicOff, Radio, ShieldOff, Square, UserX, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { sendRoomPersonaCommand, transcribeRoomPersonaAudio } from '@/lib/room-persona-client';

export type PersonaMetadata = {
  type?: string;
  personaId?: string;
  displayName?: string;
  avatar?: string;
  source?: string;
  bot?: boolean;
  voice?: boolean | string;
  livekitTtsDescriptor?: string;
  research?: boolean;
  wakeNames?: string[];
  aliases?: string[];
  previousNames?: string[];
  interests?: string[];
  ownerTenantId?: string;
  ownerName?: string;
  idleAvatar?: string;
  talkingAvatar?: string;
};

type TalkStatus = 'idle' | 'recording' | 'transcribing' | 'sending' | 'done' | 'error';

export function parsePersonaMetadata(metadata?: string): PersonaMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as PersonaMetadata;
    return parsed && parsed.type === 'persona' ? parsed : null;
  } catch {
    return null;
  }
}

export function isPersonaParticipant(participant: Participant) {
  return participant.identity.startsWith('persona:') || !!parsePersonaMetadata(participant.metadata);
}

export default function PersonaCard({ participant, roomId, isHost = false }: { participant: Participant; roomId: string; isHost?: boolean }) {
  const { toast } = useToast();
  const metadata = parsePersonaMetadata(participant.metadata) || {};
  const displayName = metadata.displayName || participant.name || participant.identity.replace(/^persona:/, '') || 'StreamWeaver Persona';
  const isSpeaking = participant.isSpeaking;
  const avatar = (isSpeaking ? metadata.talkingAvatar : metadata.idleAvatar) || metadata.avatar || '';
  const [volume, setVolume] = React.useState(1);
  const [pendingAction, setPendingAction] = React.useState('');
  const [talkStatus, setTalkStatus] = React.useState<TalkStatus>('idle');
  const [talkTranscript, setTalkTranscript] = React.useState('');
  const [talkReply, setTalkReply] = React.useState('');
  const [talkError, setTalkError] = React.useState('');
  const lastVolume = React.useRef(1);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recorderStreamRef = React.useRef<MediaStream | null>(null);
  const recorderTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const remote = participant as RemoteParticipant;
    if (volume > 0) lastVolume.current = volume;
    if (typeof remote.setVolume === 'function') remote.setVolume(volume);
  }, [participant, volume]);

  React.useEffect(() => () => {
    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {}
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const personaTargetId = metadata.ownerTenantId || metadata.personaId || participant.identity.replace(/^persona:/, '');

  const sendTranscript = React.useCallback(async (transcript: string) => {
    if (!personaTargetId) throw new Error(`${displayName} does not have a persona target ID.`);
    setTalkStatus('sending');
    const result = await sendRoomPersonaCommand({
      roomId,
      transcript,
      targetTenantId: personaTargetId,
      fallbackDisplayName: displayName,
    });
    setTalkReply(result.reply);
    if (result.speechError) throw new Error(result.speechError);
    setTalkStatus('done');
  }, [displayName, personaTargetId, roomId]);

  const finishRecording = React.useCallback(async (chunks: Blob[], stream: MediaStream, mimeType: string) => {
    if (recorderTimerRef.current) {
      clearTimeout(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    stream.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    recorderRef.current = null;

    try {
      setTalkStatus('transcribing');
      const audioBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      const transcription = await transcribeRoomPersonaAudio(audioBlob);
      if (!transcription) throw new Error('I did not hear any words. Try again and speak after the button turns red.');

      setTalkTranscript(transcription);
      await sendTranscript(transcription);
    } catch (error) {
      setTalkStatus('error');
      setTalkError(error instanceof Error ? error.message : String(error));
    }
  }, [sendTranscript]);

  const startTalkRecording = React.useCallback(async () => {
    if (talkStatus === 'recording') {
      try { recorderRef.current?.stop(); } catch {}
      return;
    }
    if (talkStatus === 'transcribing' || talkStatus === 'sending') return;

    setTalkTranscript('');
    setTalkReply('');
    setTalkError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => void finishRecording(chunks, stream, mimeType);
      recorder.start();
      setTalkStatus('recording');
      recorderTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 8000);
    } catch (error) {
      setTalkStatus('error');
      setTalkError(error instanceof Error ? error.message : String(error));
    }
  }, [finishRecording, talkStatus]);

  const isServerMuted = !participant.isMicrophoneEnabled;
  const adminAction = async (action: 'mute' | 'unmute' | 'kick' | 'ban') => {
    setPendingAction(action);
    try {
      const response = await fetch('/api/room-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          roomId,
          targetUserId: participant.identity,
          targetParticipantIdentity: participant.identity,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || `Could not ${action} ${displayName}`));
      if (action === 'kick' || action === 'ban') {
        await fetch('/api/bots/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'leave',
            roomId,
            botId: metadata.ownerTenantId || metadata.personaId,
          }),
        }).catch(() => null);
      }
      toast({ title: `${displayName} ${payload?.action || action}` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Persona control failed', description: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingAction('');
    }
  };

  const talkBusy = talkStatus === 'transcribing' || talkStatus === 'sending';

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-grow flex-col gap-4 p-4">
        <div className="flex items-start gap-4">
          <div className="relative">
          <Avatar className={`h-16 w-16 transition-all ${isSpeaking ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-background shadow-lg' : 'ring-2 ring-primary/30'}`}>
            {avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
            <AvatarFallback><Bot className="h-7 w-7" /></AvatarFallback>
          </Avatar>
            <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-background ${isSpeaking ? 'bg-green-500' : 'bg-primary'}`} />
          </div>

          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-lg font-bold">{displayName}</p>
            <Badge variant="secondary" className="gap-1"><Bot className="h-3 w-3" />BOT</Badge>
          </div>
          {metadata.ownerName && (
            <p className="mt-1 truncate text-xs text-muted-foreground">Owned by {metadata.ownerName}</p>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio className={`h-3.5 w-3.5 ${isSpeaking ? 'animate-pulse text-green-500' : ''}`} />
            {isSpeaking ? 'Speaking' : 'StreamWeaver persona connected'}
          </p>
            {metadata.research && <p className="mt-2 text-xs text-muted-foreground">Research enabled</p>}
            {isHost && (
              <div className="mt-2 flex items-center gap-1">
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!pendingAction} onClick={() => void adminAction('ban')}><ShieldOff className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Ban persona</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button variant={isServerMuted ? 'destructive' : 'ghost'} size="icon" className="h-7 w-7" disabled={!!pendingAction} onClick={() => void adminAction(isServerMuted ? 'unmute' : 'mute')}><MicOff className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{isServerMuted ? 'Unmute persona' : 'Server mute persona'}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!pendingAction} onClick={() => void adminAction('kick')}><UserX className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Kick persona</TooltipContent></Tooltip>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <Button
            type="button"
            className="w-full"
            variant={talkStatus === 'recording' ? 'destructive' : 'secondary'}
            disabled={talkBusy}
            onClick={() => void startTalkRecording()}
          >
            {talkStatus === 'recording' ? <Square className="mr-2 h-4 w-4" /> : talkBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            {talkStatus === 'recording'
              ? 'Stop & send'
              : talkStatus === 'transcribing'
                ? 'Turning speech into text…'
                : talkStatus === 'sending'
                  ? `Sending to ${displayName}…`
                  : `Talk to ${displayName}`}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {talkStatus === 'recording'
              ? 'Listening now. Speak normally; click again to send now, or it sends automatically after 8 seconds.'
              : 'Fallback button: click once, speak, see exactly what was heard, then the same canonical text route is sent to this bot.'}
          </p>
          {talkTranscript ? (
            <div className="mt-3 rounded-md border bg-background/70 p-2 text-sm">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">You said</div>
              <div>{talkTranscript}</div>
            </div>
          ) : null}
          {talkReply ? (
            <div className="mt-2 rounded-md border bg-background/70 p-2 text-sm">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{displayName} replied</div>
              <div>{talkReply}</div>
            </div>
          ) : null}
          {talkError ? <div className="mt-2 text-sm text-destructive">{talkError}</div> : null}
        </div>

        <div className="mt-auto flex items-center gap-2">
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setVolume((current) => current > 0 ? 0 : lastVolume.current)}>{volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{volume > 0 ? 'Mute for me' : 'Unmute for me'}</TooltipContent></Tooltip>
          <Slider aria-label={`${displayName} volume`} value={[volume]} onValueChange={(value) => setVolume(value[0])} max={1} step={0.05} />
        </div>
      </CardContent>
    </Card>
  );
}
