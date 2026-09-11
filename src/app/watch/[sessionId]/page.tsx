import { redirect } from 'next/navigation';
import { normalizeWatchSessionAlias } from '@/lib/watch-session';
export default async function WatchRoomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  redirect(`/activity?sessionId=${encodeURIComponent(normalizeWatchSessionAlias(sessionId))}`);
}
