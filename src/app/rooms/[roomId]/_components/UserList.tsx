'use client';

import UserCard from "./UserCard";
import React from "react";
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useLocalParticipant, useRemoteParticipants, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import '@livekit/components-styles';

export interface RoomData {
  name: string;
  ownerId: string;
  djId?: string;
  djDisplayName?: string;
}

export default function UserList({ 
    roomId
}: { 
    roomId: string
}) {
  const { firestore, user } = useFirebase();
  
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  const allParticipants = [localParticipant, ...remoteParticipants];
  
  // Log participant audio tracks for debugging
  React.useEffect(() => {
    console.log('[UserList] Total participants:', allParticipants.length);
    allParticipants.forEach(p => {
      const audioTracks = Array.from(p.audioTrackPublications.values());
      console.log(`[UserList] Participant ${p.identity}:`, {
        isLocal: p.isLocal,
        audioTracks: audioTracks.length,
        micEnabled: p.isMicrophoneEnabled,
        tracks: audioTracks.map(t => ({ 
          sid: t.trackSid, 
          subscribed: t.isSubscribed,
          enabled: t.isEnabled,
          muted: t.isMuted,
          source: t.source
        }))
      });
    });
  }, [allParticipants.length, remoteParticipants.length]);

  const roomRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return doc(firestore, 'rooms', roomId);
  }, [firestore, roomId]);

  const { data: room } = useDoc<RoomData>(roomRef);

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {allParticipants.map((participant) => (
            <UserCard
              key={participant.sid}
              participant={participant}
              isLocal={participant.isLocal}
              isHost={user?.uid === room?.ownerId}
              roomId={roomId}
            />
          ))}
        </div>
      </div>
    </>
  );
}
