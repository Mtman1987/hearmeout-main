import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export function useRoom(roomId: string) {
  const { firestore } = useFirebase();
  const [room, setRoom] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!firestore || !roomId) return;

    const unsubscribe = onSnapshot(
      doc(firestore, 'rooms', roomId),
      (snapshot) => {
        if (snapshot.exists()) {
          setRoom({ id: snapshot.id, ...snapshot.data() });
        } else {
          setError(new Error('Room not found'));
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, roomId]);

  return { room, loading, error };
}
