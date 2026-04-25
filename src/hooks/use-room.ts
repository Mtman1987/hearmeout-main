import { useDoc } from '@/hooks/use-db';

export function useRoom(roomId: string) {
  const { data: room, isLoading: loading, error } = useDoc('rooms', roomId, 2000);
  return { room, loading, error };
}
