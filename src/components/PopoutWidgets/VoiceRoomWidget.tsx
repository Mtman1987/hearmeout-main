'use client';

import React, { useState, useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Participant, LocalParticipant, RemoteParticipant } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, LogOut, Volume2 } from 'lucide-react';
import { DraggableContainer } from './DraggableContainer';

interface VoiceRoomWidgetProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onClose: () => void;
}

export function VoiceRoomWidget({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  onClose,
}: VoiceRoomWidgetProps) {
  const room = useRoomContext();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!room) return;

    const updateParticipants = () => {
      const allParticipants: Participant[] = [];
      
      if (room.localParticipant) {
        allParticipants.push(room.localParticipant);
      }
      
      if (room.remoteParticipants) {
        allParticipants.push(...Array.from(room.remoteParticipants.values()));
      }
      
      setParticipants(allParticipants);
    };

    updateParticipants();

    room.on('participantConnected', updateParticipants);
    room.on('participantDisconnected', updateParticipants);
    room.on('trackSubscribed', updateParticipants);
    room.on('trackUnsubscribed', updateParticipants);

    return () => {
      room.off('participantConnected', updateParticipants);
      room.off('participantDisconnected', updateParticipants);
      room.off('trackSubscribed', updateParticipants);
      room.off('trackUnsubscribed', updateParticipants);
    };
  }, [room]);

  const handleToggleMute = async () => {
    if (room?.localParticipant) {
      try {
        await room.localParticipant.setMicrophoneEnabled(!isMuted);
        setIsMuted(!isMuted);
      } catch (error) {
        console.error('Error toggling microphone:', error);
      }
    }
  };

  const handleLeave = async () => {
    if (room) {
      try {
        await room.disconnect();
      } catch (error) {
        console.error('Error disconnecting:', error);
      } finally {
        onClose();
      }
    }
  };

  return (
    <DraggableContainer
      id={id}
      position={position}
      size={size}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onClose={onClose}
      title="🎤 Voice Room"
    >
      <div className="flex flex-col overflow-hidden flex-1 p-3 gap-2">
        {/* Participant Count */}
        <div className="text-xs font-semibold text-muted-foreground px-1">
          Active Users: {participants.length}
        </div>

        {/* Participants List */}
        <div className="space-y-1 flex-1 overflow-y-auto">
          {participants.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No active participants
            </div>
          ) : (
            participants.map((participant) => (
              <ParticipantItem key={participant.sid} participant={participant} />
            ))
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant={isMuted ? 'destructive' : 'default'}
            onClick={handleToggleMute}
            className="flex-1 text-xs"
          >
            {isMuted ? (
              <MicOff className="w-3 h-3 mr-1" />
            ) : (
              <Mic className="w-3 h-3 mr-1" />
            )}
            {isMuted ? 'Muted' : 'Live'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleLeave}
            className="flex-1 text-xs"
          >
            <LogOut className="w-3 h-3 mr-1" />
            Leave
          </Button>
        </div>
      </div>
    </DraggableContainer>
  );
}

function ParticipantItem({ participant }: { participant: Participant }) {
  const isSpeaking = participant.isSpeaking;
  const isMuted = !participant.isMicrophoneEnabled;

  return (
    <div
      className={`text-xs px-2 py-1.5 rounded transition-all ${
        isSpeaking
          ? 'bg-green-500/20 text-green-700 dark:text-green-400 border border-green-500/50'
          : 'bg-muted text-muted-foreground border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0">
          {isSpeaking ? '🎤' : '•'}
        </span>
        <span className="truncate font-medium flex-1">{participant.name || 'User'}</span>
        {isMuted && (
          <span className="flex-shrink-0 text-red-500 text-xs" title="Muted">
            🔇
          </span>
        )}
        {isSpeaking && (
          <Volume2 className="w-3 h-3 flex-shrink-0 text-green-500" />
        )}
      </div>
    </div>
  );
}
