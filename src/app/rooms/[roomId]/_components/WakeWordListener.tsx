'use client';

import React from 'react';
import type { RemoteParticipant } from 'livekit-client';
import { useSession } from '@/hooks/use-session';
import { useCollection } from '@/hooks/use-db';
import { isPersonaParticipant, parsePersonaMetadata } from './PersonaCard';
import { resolveBotInvocation, type RoomBotDescriptor } from '@/lib/room-persona-routing';
import {
  postRoomChatMessage,
  sendRoomPersonaCommand,
  type RoomChatMessage,
} from '@/lib/room-persona-client';

/**
 * Production wake-word contract:
 *
 * - HearMeOut never continuously uploads room speech for STT.
 * - The always-on wake detector belongs to a local Companion client.
 * - A local Companion emits this event only after its on-device listener has
 *   matched a wake phrase such as "Hey Athena".
 * - The deliberate Talk button remains the browser-only fallback and is the
 *   only browser path that records audio for cloud STT.
 */
export const LOCAL_COMPANION_WAKE_EVENT = 'spmt-companion-athena-command';

type RoomBotPresence = { id?: string; uid?: string; bot?: boolean; presenceKind?: string; displayName?: string; personaId?: string; ownerTenantId?: string; wakeNames?: string[]; aliases?: string[]; previousNames?: string[] };

type LocalCompanionWakeDetail = {
  transcript?: string;
  source?: string;
  capturedAt?: number;
};

function descriptorForPersona(participant: RemoteParticipant): RoomBotDescriptor | null {
  if (!isPersonaParticipant(participant)) return null;
  const metadata = parsePersonaMetadata(participant.metadata) || {};
  const identityName = participant.identity.replace(/^persona:/, '');
  const displayName = String(metadata.displayName || participant.name || identityName || 'StreamWeaver Bot').trim();
  const wakeNames = Array.from(new Set([
    displayName,
    metadata.personaId,
    participant.name,
    identityName,
    ...(metadata.wakeNames || []),
    ...(metadata.aliases || []),
    ...(metadata.previousNames || []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const targetTenantId = String(metadata.ownerTenantId || metadata.personaId || identityName || '').trim();
  if (!targetTenantId || !wakeNames.length) return null;
  return { displayName, wakeNames, targetTenantId };
}

function chatMessage(username: string, text: string, prefix = 'wake'): RoomChatMessage {
  return {
    id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    username,
    text,
    timestamp: new Date().toISOString(),
  };
}

export default function WakeWordListener({ roomId, remoteParticipants }: { roomId: string; remoteParticipants: RemoteParticipant[] }) {
  const { user } = useSession();
  const commandInFlightRef = React.useRef(false);
  const lastTranscriptRef = React.useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const processingQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const { data: roomUsers } = useCollection<RoomBotPresence>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const targets = React.useMemo(() => {
    const liveTargets = remoteParticipants.map(descriptorForPersona).filter(Boolean) as RoomBotDescriptor[];
    const presenceTargets = (roomUsers || []).flatMap((presence) => {
      if (presence.bot !== true && presence.presenceKind !== 'persona') return [];
      const identityName = String(presence.personaId || presence.ownerTenantId || presence.id || presence.uid || '').replace(/^persona:/, '').trim();
      const displayName = String(presence.displayName || identityName || 'StreamWeaver Bot').trim();
      const targetTenantId = String(presence.ownerTenantId || presence.personaId || identityName).trim();
      const wakeNames = Array.from(new Set([displayName, targetTenantId, ...(presence.wakeNames || []), ...(presence.aliases || []), ...(presence.previousNames || [])].map((value) => String(value || '').trim()).filter(Boolean)));
      return targetTenantId ? [{ displayName, wakeNames, targetTenantId }] : [];
    });
    return Array.from(new Map([...liveTargets, ...presenceTargets].map((target) => [target.targetTenantId, target])).values());
  }, [remoteParticipants, roomUsers]);
  const humanName = String(user?.displayName || (user as any)?.username || 'HearMeOut User').trim();
  const actorIdentity = String(user?.uid || '').trim();
  const actorUsername = String((user as any)?.username || user?.displayName || '').trim();

  React.useEffect(() => {
    const handleLocalWake = (event: Event) => {
      const detail = (event as CustomEvent<LocalCompanionWakeDetail>).detail || {};
      const transcript = String(detail.transcript || '').trim();
      if (!transcript) return;

      const invocation = resolveBotInvocation(transcript, targets)
        || (/\bstella\b/i.test(transcript) ? targets[0] || null : null);
      const targetTenantId = invocation?.targetTenantId;
      if (!invocation || !targetTenantId) return;
      const targetDisplayName = invocation.displayName;
      const commandTranscript = transcript.replace(/\bstella\b[:,]?/ig, '').trim() || transcript;

      const normalized = transcript.toLowerCase();
      const recent = lastTranscriptRef.current;
      if (recent.text === normalized && Date.now() - recent.at < 3_000) return;
      lastTranscriptRef.current = { text: normalized, at: Date.now() };

      processingQueueRef.current = processingQueueRef.current
        .then(async () => {
          if (commandInFlightRef.current) return;
          commandInFlightRef.current = true;
          try {
            await postRoomChatMessage(chatMessage(humanName, transcript, 'local_wake_user')).catch((error) => {
              console.warn('[LocalWake] transcript could not be mirrored into room chat:', error);
            });

            const result = await sendRoomPersonaCommand({
              roomId,
              transcript: commandTranscript,
              targetTenantId,
              fallbackDisplayName: targetDisplayName,
              actorIdentity,
              actorUsername,
              actorDisplayName: humanName,
            });

            if (result.reply) {
              await postRoomChatMessage(chatMessage(result.botName, result.reply, 'local_wake_bot')).catch((error) => {
                console.warn('[LocalWake] bot reply could not be mirrored into room chat:', error);
              });
            }
            if (result.speechError) {
              await postRoomChatMessage(chatMessage(
                'Bots',
                `${result.botName} replied in text, but voice playback failed: ${result.speechError}`,
                'local_wake_error',
              )).catch(() => {});
            }
          } catch (error) {
            await postRoomChatMessage(chatMessage(
              'Bots',
              `${targetDisplayName} could not respond: ${error instanceof Error ? error.message : String(error)}`,
              'local_wake_error',
            )).catch(() => {});
          } finally {
            commandInFlightRef.current = false;
          }
        })
        .catch((error) => console.warn('[LocalWake] command processing failed:', error));
    };

    window.addEventListener(LOCAL_COMPANION_WAKE_EVENT, handleLocalWake);
    return () => window.removeEventListener(LOCAL_COMPANION_WAKE_EVENT, handleLocalWake);
  }, [actorIdentity, actorUsername, humanName, roomId, targets]);

  return null;
}
