'use client';

import UserCard from "./UserCard";
import OverlayCard from "./OverlayCard";
import React from "react";
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useLocalParticipant, useRemoteParticipants, useTracks, AudioTrack } from '@livekit/components-react';
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
  
  // Separate overlay viewer from regular participants
  const overlayParticipant = allParticipants.find(p => p.identity === 'overlay-viewer');
  const regularParticipants = allParticipants.filter(p => p.identity !== 'overlay-viewer');
  
  // Get ALL audio tracks from ALL participants (including local DJ's music)
  const allAudioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.Unknown],
    { onlySubscribed: true }
  ).filter(track => track.publication && !track.participant.isLocal);
  
  // Log participant audio tracks for debugging
  React.useEffect(() => {
    console.log('[UserList] Total participants:', allParticipants.length);
    console.log('[UserList] Total audio tracks to render:', allAudioTracks.length);
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
  }, [allParticipants.length, remoteParticipants.length, allAudioTracks.length]);

  const roomRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return doc(firestore, 'rooms', roomId);
  }, [firestore, roomId]);

  const { data: room } = useDoc<RoomData>(roomRef);

  return (
    <>
      {/* Render ALL audio tracks from remote participants globally */}
      {allAudioTracks.map((trackRef) => {
        console.log(`[UserList] Rendering global audio track:`, {
          participant: trackRef.participant.identity,
          trackSid: trackRef.publication.trackSid,
          source: trackRef.source,
        });
        return (
          <AudioTrack 
            key={trackRef.publication.trackSid} 
            trackRef={trackRef} 
            volume={1.0}
            muted={false}
          />
        );
      })}
      
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {regularParticipants.map((participant) => (
            <UserCard
              key={participant.sid}
              participant={participant}
              isLocal={participant.isLocal}
              isHost={user?.uid === room?.ownerId}
              roomId={roomId}
            />
          ))}
          {overlayParticipant && (
            <OverlayCard participant={overlayParticipant} roomId={roomId} />
          )}
        </div>
      </div>
    </>
  );
}
