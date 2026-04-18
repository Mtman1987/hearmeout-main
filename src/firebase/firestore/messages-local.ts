import React from 'react';
import { setDoc, listDocs, getDoc } from '../../../local-db';

export function addMessageToRoom(roomId: string, message: any) {
  const messagesDir = `rooms/${roomId}/messages`;
  const id = Date.now().toString();
  setDoc(messagesDir, id, { ...message, createdAt: Date.now(), id });
}

export function useRoomMessages(roomId: string) {
  const [messages, setMessages] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!roomId) return;
    const ids = listDocs(`rooms/${roomId}/messages`);
    const msgs = ids.map((id: string) => getDoc(`rooms/${roomId}/messages`, id));
    msgs.sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0));
    setMessages(msgs);
  }, [roomId]);
  return messages;
}
