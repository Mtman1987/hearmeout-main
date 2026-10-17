'use client';

import UserCard from "./UserCard";
import PersonaCard, { isPersonaParticipant } from './PersonaCard';
import DJCard from "./DJCard";
import MobileVoiceControl from './MobileVoiceControl';
import WakeWordListener from './WakeWordListener';
import StellaWakeTestListener from './StellaWakeTestListener';
import React from "react";
import { useSession } from '@/hooks/use-session';
import { useCollection, useDoc } from '@/hooks/use-db';
import { useLocalParticipant, useRemoteParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import { canManageRoom } from '@/lib/room-access';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Radio } from 'lucide-react';
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
  bot?: boolean;
  presenceKind?: string;
};

function PeerPresenceParticipants({ roomId, localUserId, connectedPeerIds }: { roomId: string; localUserId?: string; connectedPeerIds: string[] }) {
  const { data: users } = useCollection<PeerPresence>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const activeUsers = (users || []).filter((presence) => {
    // Say Player personas are rendered once by SayPlayerPersonaCards, using the same
    // actionable PersonaCard UI as LiveKit personas. Never duplicate them here.
    if (presence.bot === true || presence.presenceKind === 'persona') return false;
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
        const isPersona = presence.bot === true || presence.presenceKind === 'persona';
        const mediaConnected = !isPersona && connectedPeerIds.some((peerId) =>
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
                <p className={`mt-1 flex items-center gap-1.5 text-xs ${mediaConnected || isPersona ? 'text-green-500' : 'text-amber-500'}`}>
                  <Radio className="h-3.5 w-3.5" /> {isPersona ? 'Say Player broadcast · no P2P' : mediaConnected ? 'P2P audio connected' : 'Connecting P2P audio…'}
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

const isRoomTtsParticipant = (identity?: string) =>
  !!identity && identity.startsWith('room-tts:');

function SayPlayerPersonaCards({ roomId, isHost }: { roomId: string; isHost: boolean }) {
  const liveParticipants = useRemoteParticipants();
  const { data: users } = useCollection<PeerPresence & { personaId?: string; ownerTenantId?: string; ownerName?: string; wakeNames?: string[]; aliases?: string[]; serverMuted?: boolean; avatar?: string; idleAvatar?: string; talkingAvatar?: string }>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const livePersonaIds = new Set(liveParticipants.filter(isPersonaParticipant).map((participant) => participant.identity.replace(/^persona:/, '')));
  const personas = (users || []).filter((presence) =>
    (presence.bot === true || presence.presenceKind === 'persona')
    && !livePersonaIds.has(String(presence.ownerTenantId || presence.personaId || presence.id || '').replace(/^persona:/, ''))
  );
  return (
    <>
      {personas.map((persona) => {
        const displayName = persona.displayName || 'StreamWeaver Persona';
        const personaId = String(persona.ownerTenantId || persona.personaId || persona.id || '').replace(/^persona:/, '');
        // Reuse PersonaCard so Say Player personas inherit the normal card layout,
        // mute/ban/kick controls, Talk button, and local volume slider.
        const participant = {
          identity: `persona:${personaId}`,
          name: displayName,
          metadata: JSON.stringify({
            type: 'persona',
            personaId,
            ownerTenantId: personaId,
            ownerName: persona.ownerName || '',
            displayName,
            avatar: persona.photoURL || '',
            idleAvatar: persona.photoURL || '',
            talkingAvatar: persona.talkingAvatar || persona.photoURL || '',
            wakeNames: persona.wakeNames || [],
            aliases: persona.aliases || [],
            bot: true,
          }),
          isSpeaking: false,
          isMicrophoneEnabled: !persona.serverMuted,
          setVolume: () => {},
        } as any;
        return <PersonaCard key={persona.id || personaId || displayName} participant={participant} roomId={roomId} isHost={isHost} />;
      })}
    </>
  );
}

function LiveKitParticipants({ isHost, roomId }: { isHost: boolean; roomId: string }) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const voiceInputParticipants = remoteParticipants.filter(
    (participant) => !isRoomTtsParticipant(participant?.identity) && !isHiddenBridgeParticipant(participant?.identity),
  );
  const allParticipants = [localParticipant, ...remoteParticipants].filter(
    (participant) => !isHiddenBridgeParticipant(participant?.identity) && !isRoomTtsParticipant(participant?.identity),
  );

  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track =>
    track.publication
    && !track.participant.isLocal
    && !isHiddenBridgeParticipant(track.participant.identity)
    // RoomAudioPlayback already renders this system TTS track. Excluding it
    // here prevents the same synthesized voice from being played twice.
    && !isRoomTtsParticipant(track.participant.identity)
  );

  return (
    <>
      {/* One authoritative human-speech path for the entire room. It records
          the already-published LiveKit mic, transcribes through the same STT as
          the persona Talk button, applies the same wake-name resolver as typed
          chat, and sends through /api/bot/commands. System room TTS is audible
          but deliberately excluded from STT so a spoken bot reply cannot wake
          another bot and feed back into itself. */}
      <WakeWordListener roomId={roomId} remoteParticipants={voiceInputParticipants} />
      <StellaWakeTestListener roomId={roomId} remoteParticipants={voiceInputParticipants} />
      <MobileVoiceControl roomId={roomId} remoteParticipants={voiceInputParticipants} />
      {allAudioTracks.map((trackRef) => (
        <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} volume={1.0} muted={false} />
      ))}
      {allParticipants.map((participant) => (
        isPersonaParticipant(participant)
          ? <PersonaCard key={participant.sid} participant={participant} roomId={roomId} isHost={isHost} />
          : <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isHost={isHost} roomId={roomId} />
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
          {showDJ && (
            <DJCard
              roomId={roomId}
              localVolume={localVolume}
              onVolumeChange={onVolumeChange}
              canControl={canControl}
              onOpenQueue={onOpenQueue}
              onOpenAddSong={onOpenAddSong}
              onOpenWatch={onOpenWatch}
            />
          )}
          {voiceEnabled && <LiveKitParticipants isHost={isHost} roomId={roomId} />}
          <SayPlayerPersonaCards roomId={roomId} isHost={isHost} />
          {voicePeerFallback && <PeerPresenceParticipants roomId={roomId} localUserId={user?.uid} connectedPeerIds={peerConnectedPeerIds} />}
        </div>
      </div>
    </>
  );
}