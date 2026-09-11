'use client';
import { useEffect } from 'react';
import type { Participant } from 'livekit-client';
import { ParticipantEvent } from 'livekit-client';
import { applyParticipantVolume } from '@/lib/participant-volume';
import { useListenerAudio } from './use-listener-audio';

export function useParticipantVolume(participant: Participant) {
  const audio = useListenerAudio(`voice:${participant.identity}`);
  useEffect(() => {
    const apply = () => applyParticipantVolume(participant, audio.volume);
    apply();
    participant.on(ParticipantEvent.TrackSubscribed, apply);
    return () => { participant.off(ParticipantEvent.TrackSubscribed, apply); };
  }, [participant, audio.volume]);
  return audio;
}
