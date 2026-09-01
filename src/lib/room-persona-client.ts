'use client';

export const ROOM_CHAT_MESSAGE_EVENT = 'hmo-room-chat-message';

export type RoomChatMessage = {
  id: string;
  username: string;
  text: string;
  timestamp: string;
};

export type RoomPersonaCommandResult = {
  payload: any;
  reply: string;
  botName: string;
  speechError: string;
};

function responseError(payload: any, fallback: string) {
  const value = payload?.data?.error || payload?.error?.message || payload?.error;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read microphone audio.'));
    reader.readAsDataURL(blob);
  });
}

export async function transcribeRoomPersonaAudio(audioBlob: Blob) {
  const dataUrl = await blobToDataUrl(audioBlob);
  const base64Audio = dataUrl.split(',')[1] || '';
  if (!base64Audio) throw new Error('No microphone audio was captured.');

  const response = await fetch('/api/internal/persona-transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Audio }),
  });
  const payload = await response.json().catch(() => ({}));
  const transcription = String(payload?.data?.transcription || payload?.transcription || '').trim();
  if (!response.ok || (!transcription && (payload?.data?.error || payload?.error))) {
    throw new Error(responseError(payload, 'Transcription failed.'));
  }
  return transcription;
}

export async function sendRoomPersonaCommand(input: {
  roomId: string;
  transcript: string;
  targetTenantId: string;
  fallbackDisplayName: string;
  actorIdentity?: string;
  actorUsername?: string;
  actorDisplayName?: string;
}): Promise<RoomPersonaCommandResult> {
  const response = await fetch('/api/bot/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: input.transcript,
      transcript: input.transcript,
      roomId: input.roomId,
      targetTenantId: input.targetTenantId,
      actorIdentity: input.actorIdentity,
      actorUsername: input.actorUsername,
      actorDisplayName: input.actorDisplayName,
      speak: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responseError(payload, `Could not send speech to ${input.fallbackDisplayName}.`));
  }
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const speech = payload?.personaSpeech;
  return {
    payload,
    reply: String(data?.response || payload?.response || '').trim(),
    botName: String(
      payload?.bot?.name
      || payload?.data?.bot?.name
      || input.fallbackDisplayName
      || 'StreamWeaver Bot',
    ).trim(),
    speechError: speech?.attempted && speech?.ok === false
      ? String(speech?.error || `voice handoff returned ${speech?.status || 'an error'}`)
      : '',
  };
}

export async function postRoomChatMessage(message: RoomChatMessage) {
  const response = await fetch('/api/admin-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(responseError(payload, `Could not post room chat (${response.status}).`));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<RoomChatMessage>(ROOM_CHAT_MESSAGE_EVENT, { detail: message }));
  }
}
