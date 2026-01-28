'use client';

import UserCard from "./UserCard";
import React from "react";
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useLocalParticipant, useRemoteParticipants } from '@livekit/components-react';
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
