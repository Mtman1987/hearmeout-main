'use client';

import type { Participant } from 'livekit-client';
import { Bot, Radio } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export type PersonaMetadata = {
  type?: string;
  personaId?: string;
  displayName?: string;
  avatar?: string;
  source?: string;
  bot?: boolean;
  voice?: boolean;
  research?: boolean;
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

export default function PersonaCard({ participant }: { participant: Participant }) {
  const metadata = parsePersonaMetadata(participant.metadata) || {};
  const displayName = metadata.displayName || participant.name || participant.identity.replace(/^persona:/, '') || 'StreamWeaver Persona';
  const avatar = metadata.avatar || '';
  const isSpeaking = participant.isSpeaking;

  return (
    <Card className="flex h-full flex-col border-primary/30 bg-primary/5">
      <CardContent className="flex items-start gap-4 p-4">
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
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Radio className={`h-3.5 w-3.5 ${isSpeaking ? 'animate-pulse text-green-500' : ''}`} />
            {isSpeaking ? 'Speaking' : 'StreamWeaver persona connected'}
          </p>
          {metadata.research && <p className="mt-2 text-xs text-muted-foreground">Research enabled</p>}
        </div>
      </CardContent>
    </Card>
  );
}
