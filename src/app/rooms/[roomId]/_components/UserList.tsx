'use client';

import UserCard from "./UserCard";
import OverlayCard from "./OverlayCard";
import React from "react";
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { useLocalParticipant, useRemoteParticipants, useTracks, AudioTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';

export interface RoomData {
  name: string;
  ownerId: string;
  djId?: string;
  djDisplayName?: string;
}

export default function UserList({ roomId }: { roomId: string }) {
  const { user } = useSession();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const allParticipants = [localParticipant, ...remoteParticipants];
  const overlayParticipant = allParticipants.find(p => p.identity === 'overlay-viewer');
  const regularParticipants = allParticipants.filter(p => p.identity !== 'overlay-viewer');

  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication && !track.participant.isLocal);

  const { data: room } = useDoc<RoomData>('rooms', roomId);

  const isAdmin = !!user && !!(user as any).isAdmin;
  const isHost = !!user && (user.uid === room?.ownerId || isAdmin);

  return (
    <>
      {allAudioTracks.map((trackRef) => (
        <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} volume={1.0} muted={false} />
      ))}
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {regularParticipants.map((participant) => (
            <UserCard key={participant.sid} participant={participant} isLocal={participant.isLocal} isHost={isHost} roomId={roomId} />
          ))}
          {overlayParticipant && <OverlayCard participant={overlayParticipant} roomId={roomId} />}
        </div>
      </div>
    </>
  );
}
