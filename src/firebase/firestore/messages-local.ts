import { setDoc, listDocs, getDoc } from '../../../local-db';

export function addMessageToRoom(roomId, message) {
  const messagesDir = `rooms/${roomId}/messages`;
  const id = Date.now().toString();
  setDoc(messagesDir, id, { ...message, createdAt: Date.now(), id });
}

export function useRoomMessages(roomId) {
  const [messages, setMessages] = React.useState([]);
  React.useEffect(() => {
    if (!roomId) return;
    const ids = listDocs(`rooms/${roomId}/messages`);
    const msgs = ids.map(id => getDoc(`rooms/${roomId}/messages`, id));
    msgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    setMessages(msgs);
  }, [roomId]);
  return messages;
}
