'use client';

import UserCard from "./UserCard";
import PersonaCard, { isPersonaParticipant, parsePersonaMetadata } from './PersonaCard';
import DJCard from "./DJCard";
import { VoiceBridgeCard } from './VoiceBridgeCard';
import MobileVoiceControl from './MobileVoiceControl';
import WakeWordListener from './WakeWordListener';
import React from "react";
import { useSession } from '@/hooks/use-session';
import { useCollection, useDoc } from '@/hooks/use-db';
import { useLocalParticipant, useRemoteParticipants } from '@livekit/components-react';
import type { Participant, RemoteParticipant } from 'livekit-client';
import '@livekit/components-styles';
import { canManageRoom } from '@/lib/room-access';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Music, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isActivityRoomId } from '@/lib/watch-session';

export interface RoomData {
  name: string;
  ownerId: string;
}

interface UserListProps {
  roomId: string;
  localVolume: number;
  onVolumeChange: (volume: number) => void;
  showDJ: boolean;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
  voiceEnabled?: boolean;
  voicePeerFallback?: boolean;
  peerConnectedPeerIds?: string[];
  peerAudioBlocked?: boolean;
  onEnablePeerAudio?: () => void;
}

type PeerPresence = {
  id: string;
  uid?: string;
  displayName?: string;
  photoURL?: string;
  lastSeen?: number;
};

function PeerPresenceParticipants({ roomId, localUserId, connectedPeerIds }: { roomId: string; localUserId?: string; connectedPeerIds: string[] }) {
  const { data: users } = useCollection<PeerPresence>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const activeUsers = (users || []).filter((presence) => {
    if (presence.id === localUserId || presence.uid === localUserId) return false;
    const lastSeen = Number(presence.lastSeen || 0);
    return lastSeen > 0 && Date.now() - lastSeen < 45_000;
  });

  return (
    <>
      {activeUsers.map((presence) => {
        const displayName = presence.displayName || 'HearMeOut User';
        const photoURL = presence.photoURL || `https://picsum.photos/seed/${presence.id}/100/100`;
        const userIds = [presence.id, presence.uid].filter(Boolean) as string[];
        const mediaConnected = connectedPeerIds.some((peerId) =>
          userIds.some((userId) => peerId.includes(`-${userId}-`)),
        );
        return (
          <Card key={presence.id} className="flex flex-col h-full">
            <CardContent className="p-4 flex items-start gap-4">
              <Avatar className={`h-16 w-16 transition-all ${mediaConnected ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-background shadow-lg' : 'ring-1 ring-border'}`}>
                <AvatarImage src={photoURL} alt={displayName} />
                <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{displayName}</p>
                <p className={`mt-1 flex items-center gap-1.5 text-xs ${mediaConnected ? 'text-green-500' : 'text-amber-500'}`}>
                  <Radio className="h-3.5 w-3.5" /> {mediaConnected ? 'P2P audio connected' : 'Connecting P2P audio…'}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

const isHiddenBridgeParticipant = (identity?: string) =>
  !!identity && identity.startsWith('discord-bridge-listener');

const isDiscordMixParticipant = (identity?: string) =>
  !!identity && identity.startsWith('discord-mixed-');

function BotDeck({
  personas,
  showDJ,
  isHost,
  roomId,
  localVolume,
  onVolumeChange,
  canControl,
  onOpenQueue,
  onOpenAddSong,
  onOpenWatch,
}: {
  personas: Participant[];
  showDJ: boolean;
  isHost: boolean;
  roomId: string;
  localVolume: number;
  onVolumeChange: (volume: number) => void;
  canControl: boolean;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
}) {
  const [active, setActive] = React.useState<string | null>(showDJ ? 'dj' : personas[0]?.identity || null);

  React.useEffect(() => {
    if (active === 'dj' && !showDJ) {
      setActive(personas[0]?.identity || null);
      return;
    }
    if (active && active !== 'dj' && !personas.some((persona) => persona.identity === active)) {
      setActive(showDJ ? 'dj' : personas[0]?.identity || null);
      return;
    }
    if (!active) setActive(showDJ ? 'dj' : personas[0]?.identity || null);
  }, [active, personas, showDJ]);

  if (!showDJ && personas.length === 0) return null;

  const activePersona = active && active !== 'dj'
    ? personas.find((persona) => persona.identity === active)
    : null;

  return (
    <div className="relative flex h-full flex-col">
      <div className="mb-2 flex min-h-10 items-center gap-2 rounded-lg border bg-card/80 p-1.5 shadow-sm backdrop-blur">
        {showDJ ? (
          <Button
            type="button"
            variant={active === 'dj' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => setActive(active === 'dj' ? (personas[0]?.identity || null) : 'dj')}
            aria-label="HearMeOut DJ"
            title="HearMeOut DJ"
          >
            <Music className="h-4 w-4" />
          </Button>
        ) : null}
        {personas.map((persona) => {
          const metadata = parsePersonaMetadata(persona.metadata) || {};
          const label = metadata.displayName || persona.name || persona.identity.replace(/^persona:/, '') || 'Bot';
          const avatar = (persona.isSpeaking ? metadata.talkingAvatar : metadata.idleAvatar) || metadata.avatar || '';
          return (
            <Button
              key={persona.sid}
              type="button"
              variant={active === persona.identity ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-8 w-8 rounded-full p-0 ${persona.isSpeaking ? 'ring-2 ring-green-400' : ''}`}
              onClick={() => setActive(active === persona.identity ? (showDJ ? 'dj' : null) : persona.identity)}
              aria-label={label}
              title={label}
            >
              <Avatar className="h-7 w-7">
                {avatar ? <AvatarImage src={avatar} alt={label} /> : null}
                <AvatarFallback><Bot className="h-3.5 w-3.5" /></AvatarFallback>
              </Avatar>
            </Button>
          );
        })}
        <span className="ml-auto pr-2 text-[11px] text-muted-foreground">Bots</span>
      </div>

      {active === 'dj' && showDJ ? (
        <DJCard
          roomId={roomId}
          localVolume={localVolume}
          onVolumeChange={onVolumeChange}
          canControl={canControl}
          onOpenQueue={onOpenQueue}
          onOpenAddSong={onOpenAddSong}
          onOpenWatch={onOpenWatch}
        />
      ) : activePersona ? (
        <PersonaCard participant={activePersona} roomId={roomId} isHost={isHost} />
      ) : (
        <Card className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          Choose a bot icon above.
        </Card>
      )}
    </div>
  );
}

function LiveKitParticipants({
  isHost,
  canManageBridge,
  roomId,
  showDJ,
  localVolume,
  onVolumeChange,
  onOpenQueue,
  onOpenAddSong,
  onOpenWatch,
}: {
  isHost: boolean;
  canManageBridge: boolean;
  roomId: string;
  showDJ: boolean;
  localVolume: number;
  onVolumeChange: (volume: number) => void;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const bridgeParticipant = remoteParticipants.find((participant) => isDiscordMixParticipant(participant.identity)) as RemoteParticipant | undefined;
  const personas = remoteParticipants.filter((participant) => isPersonaParticipant(participant));
  const people = [localParticipant, ...remoteParticipants].filter((participant) =>
    !isHiddenBridgeParticipant(participant?.identity)
      && !isDiscordMixParticipant(participant?.identity)
      && !isPersonaParticipant(participant),
  );

  return (
    <>
      {/* RoomAudioRenderer is the single playback renderer. Do not mount a
          second AudioTrack per participant here; duplicate renderers make local
          volume controls ineffective and can create comb/echo artifacts. */}
      <WakeWordListener roomId={roomId} remoteParticipants={remoteParticipants} />
      <MobileVoiceControl roomId={roomId} remoteParticipants={remoteParticipants} />

      {(canManageBridge || bridgeParticipant) ? (
        <VoiceBridgeCard roomId={roomId} participant={bridgeParticipant} canManage={canManageBridge} />
      ) : null}

      <BotDeck
        personas={personas}
        showDJ={showDJ}
        isHost={isHost}
        roomId={roomId}
        localVolume={localVolume}
        onVolumeChange={onVolumeChange}
        canControl={canManageBridge}
        onOpenQueue={onOpenQueue}
        onOpenAddSong={onOpenAddSong}
        onOpenWatch={onOpenWatch}
      />

      {people.map((participant) => (
        <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isHost={isHost} roomId={roomId} />
      ))}
    </>
  );
}

export default function UserList({ roomId, localVolume, onVolumeChange, showDJ, onOpenQueue, onOpenAddSong, onOpenWatch, voiceEnabled = true, voicePeerFallback = false, peerConnectedPeerIds = [], peerAudioBlocked = false, onEnablePeerAudio }: UserListProps) {
  const { user } = useSession();
  const { data: room } = useDoc<RoomData>('rooms', roomId, 2000);

  const isHost = canManageRoom(user as any, room?.ownerId);
  const canControl = isHost || isActivityRoomId(roomId);

  return (
    <>
      <div className="flex flex-col gap-6">
        {voicePeerFallback && peerAudioBlocked && onEnablePeerAudio && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="text-sm">Your browser blocked incoming P2P audio.</p>
            <Button size="sm" onClick={onEnablePeerAudio}>Enable P2P Audio</Button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {voiceEnabled && (
            <LiveKitParticipants
              isHost={isHost}
              canManageBridge={canControl}
              roomId={roomId}
              showDJ={showDJ}
              localVolume={localVolume}
              onVolumeChange={onVolumeChange}
              onOpenQueue={onOpenQueue}
              onOpenAddSong={onOpenAddSong}
              onOpenWatch={onOpenWatch}
            />
          )}
          {voicePeerFallback && <PeerPresenceParticipants roomId={roomId} localUserId={user?.uid} connectedPeerIds={peerConnectedPeerIds} />}
        </div>
      </div>
    </>
  );
}
