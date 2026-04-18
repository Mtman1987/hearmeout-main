'use client';

import UserCard from "./UserCard";
import DJCard from "./DJCard";
import React from "react";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { useLocalParticipant, useRemoteParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';
import type { PlaylistItem } from '@/types/playlist';

export interface RoomData {
  name: string;
  ownerId: string;
  playlist: PlaylistItem[];
  currentTrackId?: string;
  isPlaying?: boolean;
  djActive?: boolean;
}

interface UserListProps {
  roomId: string;
  musicStatus: string | null;
  localVolume: number;
  onVolumeChange: (v: number) => void;
  showDJ: boolean;
}

export default function UserList({ roomId, musicStatus, localVolume, onVolumeChange, showDJ }: UserListProps) {
  const { user } = useSession();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = [localParticipant, ...remoteParticipants];

  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication && !track.participant.isLocal);

  const { data: room } = useDoc<RoomData>('rooms', roomId, 2000);

  const isAdmin = !!user && !!(user as any).isAdmin;
  const isHost = !!user && (user.uid === room?.ownerId || isAdmin);
  const canControl = !!user;

  return (
    <>
      {allAudioTracks.map((trackRef) => (
        <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} volume={1.0} muted={false} />
      ))}
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
              musicStatus={musicStatus}
              localVolume={localVolume}
              onVolumeChange={onVolumeChange}
              canControl={canControl}
            />
          )}
          {/* Real users */}
          {allParticipants.map((participant) => (
            <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isHost={isHost} roomId={roomId} />
          ))}
        </div>
      </div>
    </>
  );
}
