'use client';

import UserCard from "./UserCard";
import RoomSayPlayerAudio from './RoomSayPlayerAudio';
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
  peerVoiceStreams?: Map<string, MediaStream>;
  localP2PSpeaking?: boolean;
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

function useP2PStreamSpeaking(stream?: MediaStream) {
  const [speaking, setSpeaking] = React.useState(false);
  React.useEffect(() => {
    if (!stream || typeof window === 'undefined') { setSpeaking(false); return; }
    let context: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let active = false;
    let quietTicks = 0;
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      context = new AudioContextCtor();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      void context.resume().catch(() => {});
      const samples = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
        const rms = Math.sqrt(sum / samples.length);
        const detected = rms > (active ? 0.025 : 0.045);
        if (detected) quietTicks = 0; else quietTicks++;
        const next = detected || (active && quietTicks < 4);
        if (next !== active) { active = next; setSpeaking(next); }
      }, 100);
    } catch (error) {
      console.warn('[PeerVoice] Could not meter remote P2P audio:', error);
      setSpeaking(false);
    }
    return () => {
      if (timer) clearInterval(timer);
      try { source?.disconnect(); } catch {}
      if (context) void context.close().catch(() => {});
      setSpeaking(false);
    };
  }, [stream]);
  return speaking;
}

function PeerPresenceCard({ presence, connectedPeerIds, peerVoiceStreams }: {
  presence: PeerPresence;
  connectedPeerIds: string[];
  peerVoiceStreams: Map<string, MediaStream>;
}) {
  const displayName = presence.displayName || 'HearMeOut User';
  const photoURL = presence.photoURL || `https://picsum.photos/seed/${presence.id}/100/100`;
  const userIds = [presence.id, presence.uid].filter(Boolean) as string[];
  const isPersona = presence.bot === true || presence.presenceKind === 'persona';
  const peerId = !isPersona ? connectedPeerIds.find((id) => userIds.some((userId) => id.includes(`-${userId}-`))) : undefined;
  const mediaConnected = !!peerId;
  const p2pSpeaking = useP2PStreamSpeaking(peerId ? peerVoiceStreams.get(peerId) : undefined);
  return (
    <Card className="flex flex-col h-full">
      <CardContent className="p-4 flex items-start gap-4">
        <div className="relative shrink-0">
          {p2pSpeaking && <div aria-label="P2P audio activity" title="P2P audio activity detected" className="pointer-events-none absolute -inset-1 rounded-full border-4 border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.25)]" />}
          <Avatar className={`h-16 w-16 transition-all ${mediaConnected ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-background shadow-lg' : 'ring-1 ring-border'}`}>
            <AvatarImage src={photoURL} alt={displayName} />
            <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{displayName}</p>
          <p className={`mt-1 flex items-center gap-1.5 text-xs ${mediaConnected || isPersona ? 'text-green-500' : 'text-amber-500'}`}>
            <Radio className="h-3.5 w-3.5" /> {isPersona ? 'Say Player connected' : p2pSpeaking ? 'P2P audio active' : mediaConnected ? 'P2P audio connected' : 'Connecting P2P audio…'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PeerPresenceParticipants({ roomId, localUserId, connectedPeerIds, peerVoiceStreams }: {
  roomId: string;
  localUserId?: string;
  connectedPeerIds: string[];
  peerVoiceStreams: Map<string, MediaStream>;
}) {
  const { data: users } = useCollection<PeerPresence>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const activeUsers = (users || []).filter((presence) => {
    if (presence.bot === true || presence.presenceKind === 'persona') return false;
    if (presence.id === localUserId || presence.uid === localUserId) return false;
    const lastSeen = Number(presence.lastSeen || 0);
    return lastSeen > 0 && Date.now() - lastSeen < 45_000;
  });
  return <>{activeUsers.map((presence) => <PeerPresenceCard key={presence.id} presence={presence} connectedPeerIds={connectedPeerIds} peerVoiceStreams={peerVoiceStreams} />)}</>;
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
  const speechPersonaIds = personas
    .map((presence) => String(presence.ownerTenantId || presence.personaId || presence.id || '').replace(/^persona:/, ''))
    .filter(Boolean);
  return (
    <>
      {speechPersonaIds.length > 0 && <RoomSayPlayerAudio roomId={roomId} personaIds={speechPersonaIds} />}
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
            sayPlayer: true,
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

function LiveKitParticipants({ isHost, roomId, localP2PSpeaking }: { isHost: boolean; roomId: string; localP2PSpeaking: boolean }) {
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
          : <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isP2PSpeaking={participant.isLocal && localP2PSpeaking} isHost={isHost} roomId={roomId} />
      ))}
    </>
  );
}

export default function UserList({ roomId, localVolume, onVolumeChange, showDJ, onOpenQueue, onOpenAddSong, onOpenWatch, voiceEnabled = true, voicePeerFallback = false, peerConnectedPeerIds = [], peerVoiceStreams = new Map(), localP2PSpeaking = false, peerAudioBlocked = false, onEnablePeerAudio }: UserListProps) {
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
          {voiceEnabled && <LiveKitParticipants isHost={isHost} roomId={roomId} localP2PSpeaking={localP2PSpeaking} />}
          <SayPlayerPersonaCards roomId={roomId} isHost={isHost} />
          {voicePeerFallback && <PeerPresenceParticipants roomId={roomId} localUserId={user?.uid} connectedPeerIds={peerConnectedPeerIds} peerVoiceStreams={peerVoiceStreams} />}
        </div>
      </div>
    </>
  );
}