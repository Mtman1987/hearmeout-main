'use client';

import React from 'react';
import type { RemoteParticipant } from 'livekit-client';
import { useSession } from '@/hooks/use-session';
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
    ...(displayName.toLowerCase().includes('athena') ? ['Hey Athena', 'Athena', 'Athena OS', 'Annie'] : []),
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

  const targets = React.useMemo(
    () => remoteParticipants.map(descriptorForPersona).filter(Boolean) as RoomBotDescriptor[],
    [remoteParticipants],
  );
  const humanName = String(user?.displayName || (user as any)?.username || 'HearMeOut User').trim();
  const actorIdentity = String(user?.uid || '').trim();
  const actorUsername = String((user as any)?.username || user?.displayName || '').trim();

  React.useEffect(() => {
    const handleLocalWake = (event: Event) => {
      const detail = (event as CustomEvent<LocalCompanionWakeDetail>).detail || {};
      const transcript = String(detail.transcript || '').trim();
      if (!transcript) return;

      const invocation = resolveBotInvocation(transcript, targets);
      if (!invocation?.targetTenantId) return;

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
              transcript,
              targetTenantId: invocation.targetTenantId,
              fallbackDisplayName: invocation.displayName,
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
              `${invocation.displayName} could not respond: ${error instanceof Error ? error.message : String(error)}`,
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
