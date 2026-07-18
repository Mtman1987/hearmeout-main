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
  onToggleAutoRadio?: () => void;
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
  voiceFallbackFailed?: boolean;
}

type PeerPresence = {
  id: string;
  uid?: string;
  displayName?: string;
  photoURL?: string;
  lastSeen?: number;
};

function PeerPresenceParticipants({ roomId, localUserId }: { roomId: string; localUserId?: string }) {
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
        return (
          <Card key={presence.id} className="flex flex-col h-full">
            <CardContent className="p-4 flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={photoURL} alt={displayName} />
                <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{displayName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-blue-500">
                  <Radio className="h-3.5 w-3.5" /> Connected through P2P voice
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

function LiveKitParticipants({ isHost, roomId }: { isHost: boolean; roomId: string }) {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = [localParticipant, ...remoteParticipants];

  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication && !track.participant.isLocal);

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

export default function UserList({ roomId, musicStatus, djStatus, localVolume, onVolumeChange, showDJ, autoRadio, onToggleAutoRadio, djIsLive, djStarting, onStartDJ, onStopDJ, onStartAudio, onOpenQueue, onOpenAddSong, onOpenWatch, voiceEnabled = true, voicePeerFallback = false }: UserListProps) {
  const { user } = useSession();
  const { data: room } = useDoc<RoomData>('rooms', roomId, 2000);

  const isHost = canManageRoom(user as any, room?.ownerId);
  const canControl = isHost;

  return (
    <>
      <div className="flex flex-col gap-6">
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
              onToggleAutoRadio={onToggleAutoRadio}
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
          {voicePeerFallback && <PeerPresenceParticipants roomId={roomId} localUserId={user?.uid} />}
        </div>
      </div>
    </>
  );
}
