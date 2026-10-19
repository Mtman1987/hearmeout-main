'use client';

import { captureMicrophone } from '@/lib/microphone-capture';

import React from 'react';
import type { Participant, RemoteParticipant } from 'livekit-client';
import { Bot, LoaderCircle, Mic, MicOff, Radio, Settings2, ShieldOff, Square, UserX, Volume2, VolumeX } from 'lucide-react';
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
  sayPlayer?: boolean;
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

export default function PersonaCard({ participant, roomId, isHost = false, volumeOverride, onVolumeOverrideChange, onVolumeUserGesture }: { participant: Participant; roomId: string; isHost?: boolean; volumeOverride?: number; onVolumeOverrideChange?: (volume: number) => void; onVolumeUserGesture?: () => void }) {
  const { toast } = useToast();
  const metadata = parsePersonaMetadata(participant.metadata) || {};
  const displayName = metadata.displayName || participant.name || participant.identity.replace(/^persona:/, '') || 'StreamWeaver Persona';
  const isSpeaking = participant.isSpeaking;
  const avatar = (isSpeaking ? metadata.talkingAvatar : metadata.idleAvatar) || metadata.avatar || '';
  const [volume, setVolume] = React.useState(1);
  const [pendingAction, setPendingAction] = React.useState('');
  const [talkStatus, setTalkStatus] = React.useState<TalkStatus>('idle');
  const [talkPanelOpen, setTalkPanelOpen] = React.useState(false);
  const [talkTranscript, setTalkTranscript] = React.useState('');
  const [talkReply, setTalkReply] = React.useState('');
  const [talkError, setTalkError] = React.useState('');
  const [voicePanelOpen, setVoicePanelOpen] = React.useState(false);
  const [voiceOptions, setVoiceOptions] = React.useState<Array<{ id: string; label: string; gender: string; description: string }>>([]);
  const [selectedVoice, setSelectedVoice] = React.useState('');
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const [voiceMessage, setVoiceMessage] = React.useState('');
  const [voiceError, setVoiceError] = React.useState('');
  const lastVolume = React.useRef(1);
  const recorderRef = React.useRef<ReturnType<typeof captureMicrophone> | null>(null);
  const mountedRef = React.useRef(true);
  const cardVolume = metadata.sayPlayer && typeof volumeOverride === 'number' ? volumeOverride : volume;

  React.useEffect(() => {
    const remote = participant as RemoteParticipant;
    if (cardVolume > 0) lastVolume.current = cardVolume;
    if (!metadata.sayPlayer && typeof remote.setVolume === 'function') remote.setVolume(volume);
  }, [participant, volume, cardVolume, metadata.sayPlayer]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; recorderRef.current?.cancel(); };
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

  const startTalkRecording = React.useCallback(async () => {
    if (recorderRef.current) { recorderRef.current.stop(); return; }
    if (talkStatus === 'transcribing' || talkStatus === 'sending') return;
    setTalkTranscript(''); setTalkReply(''); setTalkError('');
    const recording = captureMicrophone({ ready: () => setTalkStatus('recording') });
    recorderRef.current = recording;
    try {
      const audioBlob = await recording.finished;
      recorderRef.current = null;
      if (!mountedRef.current) return;
      setTalkStatus('transcribing');
      const transcription = await transcribeRoomPersonaAudio(audioBlob);
      if (!mountedRef.current) return;
      if (!transcription) throw new Error('No spoken words were found. Speak after the microphone is ready, then tap Finish.');
      setTalkTranscript(transcription);
      await sendTranscript(transcription);
    } catch (error) {
      setTalkStatus('error');
      setTalkError(error instanceof Error ? error.message : String(error));
    } finally { recorderRef.current = null; }
  }, [sendTranscript, talkStatus]);

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

  const loadVoiceSettings = React.useCallback(async () => {
    setVoiceBusy(true);
    setVoiceError('');
    setVoiceMessage('');
    try {
      const response = await fetch(`/api/persona-voice?roomId=${encodeURIComponent(roomId)}&botId=${encodeURIComponent(personaTargetId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || 'Could not load voice settings.'));
      const data = payload?.data || payload;
      setVoiceOptions(Array.isArray(data.voices) ? data.voices : []);
      setSelectedVoice(String(data.voice || 'kokoro:af_heart'));
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [personaTargetId, roomId]);

  const changeVoiceSetting = async (action: 'save' | 'test') => {
    if (!selectedVoice || voiceBusy) return;
    setVoiceBusy(true);
    setVoiceError('');
    setVoiceMessage(action === 'test' ? 'Generating voice sample…' : '');
    try {
      const response = await fetch('/api/persona-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, botId: personaTargetId, voice: selectedVoice, action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || 'Voice action failed.'));
      const data = payload?.data || payload;
      if (action === 'save') {
        setVoiceMessage('Voice saved for this bot.');
        toast({ title: 'Bot voice saved', description: `${displayName} will use the selected voice for future replies.` });
      } else {
        const audioDataUri = String(data.audioDataUri || '');
        if (!audioDataUri.startsWith('data:audio/')) throw new Error('The voice service returned no playable sample.');
        const audio = new Audio(audioDataUri);
        await audio.play();
        setVoiceMessage('Playing voice sample…');
        audio.onended = () => setVoiceMessage('Voice sample finished.');
      }
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error));
      setVoiceMessage('');
    } finally {
      setVoiceBusy(false);
    }
  };
  const changeCardVolume = (next: number) => {
    if (metadata.sayPlayer && onVolumeOverrideChange) {
      onVolumeOverrideChange(next);
      onVolumeUserGesture?.();
    } else {
      setVolume(next);
    }
  };

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
            {isHost && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant={voicePanelOpen ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" aria-label={`Voice settings for ${displayName}`} aria-expanded={voicePanelOpen} onClick={() => {
                    const next = !voicePanelOpen;
                    setVoicePanelOpen(next);
                    if (next) void loadVoiceSettings();
                  }}>
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Voice settings</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={talkPanelOpen ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  aria-label={talkPanelOpen ? `Hide talk details for ${displayName}` : `Show talk controls for ${displayName}`}
                  aria-expanded={talkPanelOpen}
                  onClick={() => setTalkPanelOpen((open) => talkBusy || talkStatus === 'recording' ? true : !open)}
                >
                  <Mic className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{talkPanelOpen ? 'Hide talk details' : `Talk to ${displayName}`}</TooltipContent>
            </Tooltip>
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

        {voicePanelOpen && isHost && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-semibold">Bot voice</div>
            <p className="text-xs text-muted-foreground">Choose a free Kokoro voice. Test plays a short sample; Save changes this bot’s future replies.</p>
            <select
              aria-label={`Voice for ${displayName}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedVoice}
              disabled={voiceBusy || voiceOptions.length === 0}
              onChange={(event) => { setSelectedVoice(event.target.value); setVoiceMessage(''); setVoiceError(''); }}
            >
              {voiceOptions.length === 0 && <option value="">Loading voice catalog…</option>}
              {voiceOptions.map((voice) => <option key={voice.id} value={voice.id}>{voice.label} — {voice.gender}</option>)}
            </select>
            {voiceOptions.find((voice) => voice.id === selectedVoice)?.description && (
              <p className="text-xs text-muted-foreground">{voiceOptions.find((voice) => voice.id === selectedVoice)?.description}</p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" disabled={voiceBusy || !selectedVoice} onClick={() => void changeVoiceSetting('test')}>
                {voiceBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}Test voice
              </Button>
              <Button type="button" className="flex-1" disabled={voiceBusy || !selectedVoice} onClick={() => void changeVoiceSetting('save')}>Save voice</Button>
            </div>
            {voiceMessage && <p role="status" className="text-xs text-muted-foreground">{voiceMessage}</p>}
            {voiceError && <p role="alert" className="text-xs text-destructive">{voiceError}</p>}
          </div>
        )}

        {talkPanelOpen && (
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
        )}

        <div className="mt-auto flex items-center gap-2">
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" aria-label={cardVolume > 0 ? `Mute ${displayName} for me` : `Unmute ${displayName} for me`} onClick={() => changeCardVolume(cardVolume > 0 ? 0 : lastVolume.current || 0.8)}>{cardVolume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{cardVolume > 0 ? 'Mute for me' : 'Unmute for me'}</TooltipContent></Tooltip>
          <Slider aria-label={`${displayName} volume`} value={[cardVolume]} onValueChange={(value) => changeCardVolume(value[0])} max={1} step={0.05} />
        </div>
      </CardContent>
    </Card>
  );
}
