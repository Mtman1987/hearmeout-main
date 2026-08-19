'use client';

import React from 'react';
import type { Participant, RemoteParticipant } from 'livekit-client';
import { Bot, MicOff, Radio, ShieldOff, UserX, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

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
  const lastVolume = React.useRef(1);

  React.useEffect(() => {
    const remote = participant as RemoteParticipant;
    if (volume > 0) lastVolume.current = volume;
    if (typeof remote.setVolume === 'function') remote.setVolume(volume);
  }, [participant, volume]);

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
        <div className="mt-auto flex items-center gap-2">
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setVolume((current) => current > 0 ? 0 : lastVolume.current)}>{volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{volume > 0 ? 'Mute for me' : 'Unmute for me'}</TooltipContent></Tooltip>
          <Slider aria-label={`${displayName} volume`} value={[volume]} onValueChange={(value) => setVolume(value[0])} max={1} step={0.05} />
        </div>
      </CardContent>
    </Card>
  );
}
