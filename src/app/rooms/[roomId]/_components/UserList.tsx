'use client';

import UserCard from "./UserCard";
import DJCard from "./DJCard";
import React from "react";
import { useSession } from '@/hooks/use-session';
import { useCollection, useDoc } from '@/hooks/use-db';
import { useLocalParticipant, useRemoteParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import type { PlaylistItem } from '@/types/playlist';
import { canManageRoom } from '@/lib/room-access';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isActivityRoomId } from '@/lib/watch-session';

export interface RoomData {
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
  djStatus?: string;
  autoRadio?: boolean;
  playHistory?: string[];
}

interface UserListProps {
  roomId: string;
  musicStatus: string | null;
  djStatus?: string;
  localVolume: number;
  // eslint-disable-next-line no-unused-vars
  onVolumeChange: (volume: number) => void;
  showDJ: boolean;
  autoRadio?: boolean;
  djIsLive: boolean;
  djStarting?: boolean;
  onStartDJ: () => void;
  onStopDJ: () => void;
  onStartAudio: () => void;
  onOpenQueue: () => void;
  onOpenAddSong: () => void;
  onOpenWatch?: () => void;
  voiceEnabled?: boolean;
  voicePeerFallback?: boolean;
  peerConnectedPeerIds?: string[];
  peerAudioBlocked?: boolean;
  onEnablePeerAudio?: () => void;
  voiceFallbackFailed?: boolean;
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

// The voice-bridge "listener" participant only exists to pipe app audio into
// Discord — it publishes nothing and must never render a card.
const isHiddenBridgeParticipant = (identity?: string) =>
  !!identity && identity.startsWith('discord-bridge-listener');

function LiveKitParticipants({ isHost, roomId }: { isHost: boolean; roomId: string }) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = [localParticipant, ...remoteParticipants].filter(
    (participant) => !isHiddenBridgeParticipant(participant?.identity),
  );

  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication && !track.participant.isLocal && !isHiddenBridgeParticipant(track.participant.identity));

  return (
    <>
      {allAudioTracks.map((trackRef) => (
        <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} volume={1.0} muted={false} />
      ))}
      {allParticipants.map((participant) => (
        <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isHost={isHost} roomId={roomId} />
      ))}
    </>
  );
}

export default function UserList({ roomId, musicStatus, djStatus, localVolume, onVolumeChange, showDJ, autoRadio, djIsLive, djStarting, onStartDJ, onStopDJ, onStartAudio, onOpenQueue, onOpenAddSong, onOpenWatch, voiceEnabled = true, voicePeerFallback = false, peerConnectedPeerIds = [], peerAudioBlocked = false, onEnablePeerAudio }: UserListProps) {
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
          {/* DJ Card — toggled via header music note */}
          {showDJ && (
            <DJCard
              roomId={roomId}
              playlist={room?.playlist || []}
              currentTrackId={room?.currentTrackId}
              isPlaying={room?.isPlaying}
              djActive={room?.djActive}
              djStatus={room?.djStatus || djStatus}
              musicStatus={musicStatus}
              localVolume={localVolume}
              onVolumeChange={onVolumeChange}
              canControl={canControl}
              autoRadio={autoRadio}
              djIsLive={djIsLive}
              djStarting={djStarting}
              onStartDJ={onStartDJ}
              onStopDJ={onStopDJ}
              onStartAudio={onStartAudio}
              onOpenQueue={onOpenQueue}
              onOpenAddSong={onOpenAddSong}
              onOpenWatch={onOpenWatch}
            />
          )}
          {/* Real users */}
          {voiceEnabled && <LiveKitParticipants isHost={isHost} roomId={roomId} />}
          {voicePeerFallback && <PeerPresenceParticipants roomId={roomId} localUserId={user?.uid} connectedPeerIds={peerConnectedPeerIds} />}
        </div>
      </div>
    </>
  );
}
